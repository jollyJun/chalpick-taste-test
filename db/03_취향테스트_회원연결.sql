-- Additive v3 integration. Run after review on a staging DB first.
-- Never inserts into auth.users. Membership is created only after server-side
-- Supabase email OTP verification AND the existing Naver/Kakao session proof.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE SCHEMA IF NOT EXISTS chalpick_private;
CREATE TABLE IF NOT EXISTS chalpick_private.taste_import_receipts(
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,payload jsonb NOT NULL,result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,request_id)
);
ALTER TABLE chalpick_private.taste_import_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON chalpick_private.taste_import_receipts FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION chalpick_private.cp_v17_owner(p_provider text,p_external_id text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'server only' USING ERRCODE='42501';END IF;
 IF p_provider IS NULL OR p_provider NOT IN ('NAVER','KAKAO') OR p_external_id IS NULL OR length(p_external_id) NOT BETWEEN 1 AND 128 OR p_external_id ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'invalid identity' USING ERRCODE='22023';END IF;
 SELECT user_id INTO uid FROM public.user_oauth_accounts WHERE provider=p_provider AND provider_user_id=p_external_id;
 IF uid IS NULL THEN RAISE EXCEPTION 'member required' USING ERRCODE='P0404';END IF;
 RETURN uid;
END $$;

CREATE OR REPLACE FUNCTION chalpick_private.cp_v17_profile_impl(p_provider text,p_external_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid;
BEGIN
 uid:=chalpick_private.cp_v17_owner(p_provider,p_external_id);
 RETURN jsonb_build_object('status','ready','preferences',coalesce((SELECT jsonb_agg(to_jsonb(p)-'user_id') FROM public.user_media_preferences p WHERE user_id=uid),'[]'::jsonb),
 'tags',coalesce((SELECT jsonb_agg(to_jsonb(t)-'user_id') FROM public.user_media_tag_preferences t WHERE user_id=uid),'[]'::jsonb),
 'engines',coalesce((SELECT jsonb_agg(to_jsonb(e)-'user_id') FROM public.user_media_engine_preferences e WHERE user_id=uid),'[]'::jsonb),
 'learned',coalesce((SELECT jsonb_agg(to_jsonb(p)-'user_id') FROM public.user_media_taste_profiles p WHERE user_id=uid),'[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION chalpick_private.cp_v17_register_impl(p_provider text,p_external_id text,p_auth_user uuid,p_email text,p_nickname text,p_gender text,p_age_group text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid; existing_email text;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'server only' USING ERRCODE='42501';END IF;
 IF p_provider IS NULL OR p_provider NOT IN ('NAVER','KAKAO') OR p_external_id IS NULL OR length(p_external_id) NOT BETWEEN 1 AND 128 OR p_external_id ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'invalid identity' USING ERRCODE='22023';END IF;
 IF p_nickname IS NULL OR char_length(p_nickname) NOT BETWEEN 2 AND 20 OR p_gender IS NULL OR p_gender NOT IN ('FEMALE','MALE','OTHER') OR p_age_group IS NULL OR p_age_group NOT IN ('10S','20S','30S','40S','50S_PLUS') THEN RAISE EXCEPTION 'invalid member fields' USING ERRCODE='22023';END IF;
 -- The UUID is taken only from GoTrue's successful verify response by our server.
 SELECT email INTO existing_email FROM auth.users WHERE id=p_auth_user AND email_confirmed_at IS NOT NULL AND lower(email)=lower(p_email);
 IF existing_email IS NULL THEN RAISE EXCEPTION 'verified auth user required' USING ERRCODE='42501';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_provider||':'||p_external_id,1701));
 SELECT user_id INTO uid FROM public.user_oauth_accounts WHERE provider=p_provider AND provider_user_id=p_external_id;
 IF uid IS NOT NULL AND uid<>p_auth_user THEN RAISE EXCEPTION 'identity already linked' USING ERRCODE='P0409';END IF;
 INSERT INTO public.users(id,email,nickname,gender,age_group,onboarding_completed)
 VALUES(p_auth_user,existing_email,p_nickname,p_gender,p_age_group,true) ON CONFLICT(id) DO NOTHING;
 INSERT INTO public.user_oauth_accounts(user_id,provider,provider_user_id)
 VALUES(p_auth_user,p_provider,p_external_id) ON CONFLICT(provider,provider_user_id) DO NOTHING;
 RETURN jsonb_build_object('status','ready');
END $$;

CREATE OR REPLACE FUNCTION chalpick_private.cp_v17_import_impl(p_provider text,p_external_id text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='12s' AS $$
DECLARE uid uuid; rid uuid; receipt record; entry record; pref record; tag text; media_name text;
 existing text; like_count integer; saved integer:=0; conflicts integer:=0; response jsonb; policy text;
BEGIN
 uid:=chalpick_private.cp_v17_owner(p_provider,p_external_id);
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR jsonb_typeof(p_payload->'ratings') IS DISTINCT FROM 'object' OR jsonb_typeof(p_payload->'preferences') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid payload' USING ERRCODE='22023';END IF;
 IF (p_payload->>'requestId') IS NULL OR (p_payload->>'requestId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'invalid request id' USING ERRCODE='22023';END IF;
 rid:=(p_payload->>'requestId')::uuid;policy:=p_payload->>'conflictPolicy';
 IF policy IS NULL OR policy NOT IN ('preserve','replace') OR (SELECT count(*) FROM jsonb_each(p_payload->'ratings'))>300 THEN RAISE EXCEPTION 'invalid policy/size' USING ERRCODE='22023';END IF;
 SELECT count(*) INTO like_count FROM jsonb_each_text(p_payload->'ratings') WHERE value='LIKE';
 IF like_count NOT BETWEEN 5 AND 10 THEN RAISE EXCEPTION '5 to 10 likes required' USING ERRCODE='22023';END IF;
 PERFORM 1 FROM public.users WHERE id=uid FOR UPDATE;
 SELECT * INTO receipt FROM chalpick_private.taste_import_receipts WHERE user_id=uid AND request_id=rid;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION 'request changed' USING ERRCODE='P0409';END IF;
  RETURN receipt.result;
 END IF;
 FOR entry IN SELECT * FROM jsonb_each_text(p_payload->'ratings') ORDER BY key LOOP
  IF entry.key !~ '^[1-9][0-9]{0,9}$' OR entry.value NOT IN ('LIKE','DISLIKE','NEUTRAL') THEN RAISE EXCEPTION 'invalid rating' USING ERRCODE='22023';END IF;
  PERFORM 1 FROM public.contents WHERE id=entry.key::bigint;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown content' USING ERRCODE='22023';END IF;
  SELECT rating_type INTO existing FROM public.user_content_ratings WHERE user_id=uid AND content_id=entry.key::integer;
  IF existing IS NOT NULL AND existing<>entry.value AND policy='preserve' THEN conflicts:=conflicts+1;CONTINUE;END IF;
  INSERT INTO public.user_content_ratings(user_id,content_id,rating_type,source_context)
  VALUES(uid,entry.key::integer,entry.value,'TASTE_TEST') ON CONFLICT(user_id,content_id)
  DO UPDATE SET rating_type=excluded.rating_type,source_context=excluded.source_context,updated_at=now()
  WHERE user_content_ratings.rating_type IS DISTINCT FROM excluded.rating_type AND policy='replace';
  saved:=saved+1;
 END LOOP;
 FOR pref IN SELECT * FROM jsonb_each(p_payload->'preferences') LOOP
  media_name:=pref.key;
  IF media_name NOT IN ('웹툰','웹소설','OTT','영화') OR jsonb_typeof(pref.value->'liked') IS DISTINCT FROM 'array' OR jsonb_typeof(pref.value->'excluded') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid preferences' USING ERRCODE='22023';END IF;
  IF jsonb_array_length(pref.value->'liked')>50 OR jsonb_array_length(pref.value->'excluded')>50 THEN RAISE EXCEPTION 'too many tags' USING ERRCODE='22023';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(pref.value->'liked') l WHERE pref.value->'excluded' ? l.value) THEN RAISE EXCEPTION 'conflicting preferences' USING ERRCODE='22023';END IF;
  FOR tag IN SELECT jsonb_array_elements_text((pref.value->'liked')||(pref.value->'excluded')) LOOP
   PERFORM 1 FROM public.tag_dictionary WHERE tag_slug=tag AND status='KEEP';IF NOT FOUND THEN RAISE EXCEPTION 'unknown tag' USING ERRCODE='22023';END IF;
   -- Explicit settings only. Inferred dislikes and browse tags are never sent here.
   IF policy='preserve' AND EXISTS(SELECT 1 FROM public.user_media_tag_preferences WHERE user_id=uid AND media=media_name AND tag_slug=tag) THEN conflicts:=conflicts+1;CONTINUE;END IF;
   UPDATE public.user_media_tag_preferences SET preference_level=CASE WHEN pref.value->'excluded' ? tag THEN 0 ELSE 1 END,excluded=(pref.value->'excluded' ? tag)
    WHERE user_id=uid AND media=media_name AND tag_slug=tag;
   IF NOT FOUND THEN INSERT INTO public.user_media_tag_preferences(user_id,media,tag_slug,preference_level,excluded)
    VALUES(uid,media_name,tag,CASE WHEN pref.value->'excluded' ? tag THEN 0 ELSE 1 END,(pref.value->'excluded' ? tag));END IF;
  END LOOP;
 END LOOP;
 response:=chalpick_private.cp_v17_profile_impl(p_provider,p_external_id)||jsonb_build_object('savedRatings',saved,'preservedConflicts',conflicts);
 INSERT INTO chalpick_private.taste_import_receipts(user_id,request_id,payload,result) VALUES(uid,rid,p_payload,response);
 RETURN response;
END $$;

CREATE OR REPLACE FUNCTION public.cp_v17_taste_profile(p_provider text,p_external_id text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT chalpick_private.cp_v17_profile_impl(p_provider,p_external_id)$$;
CREATE OR REPLACE FUNCTION public.cp_v17_import_taste(p_provider text,p_external_id text,p_payload jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT chalpick_private.cp_v17_import_impl(p_provider,p_external_id,p_payload)$$;
CREATE OR REPLACE FUNCTION public.cp_v17_register_member(p_provider text,p_external_id text,p_auth_user uuid,p_email text,p_nickname text,p_gender text,p_age_group text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT chalpick_private.cp_v17_register_impl(p_provider,p_external_id,p_auth_user,p_email,p_nickname,p_gender,p_age_group)$$;
REVOKE ALL ON FUNCTION chalpick_private.cp_v17_owner(text,text),chalpick_private.cp_v17_profile_impl(text,text),chalpick_private.cp_v17_import_impl(text,text,jsonb),chalpick_private.cp_v17_register_impl(text,text,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.cp_v17_taste_profile(text,text),public.cp_v17_import_taste(text,text,jsonb),public.cp_v17_register_member(text,text,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA chalpick_private TO service_role;
GRANT EXECUTE ON FUNCTION chalpick_private.cp_v17_profile_impl(text,text),chalpick_private.cp_v17_import_impl(text,text,jsonb),chalpick_private.cp_v17_register_impl(text,text,uuid,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cp_v17_taste_profile(text,text),public.cp_v17_import_taste(text,text,jsonb),public.cp_v17_register_member(text,text,uuid,text,text,text,text) TO service_role;
COMMIT;
