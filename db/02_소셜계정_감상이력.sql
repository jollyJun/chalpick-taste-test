-- Run manually as the DB owner. Additive; existing v3/v4 members/data stay untouched.
-- These are Chalpick application accounts authenticated by its encrypted OAuth
-- session, NOT fabricated Supabase Auth users. No email or auth.users mutation.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
SELECT pg_catalog.pg_advisory_xact_lock(734281,12);
CREATE SCHEMA IF NOT EXISTS chalpick_private;

DO $guard$
BEGIN
  IF to_regclass('public.contents') IS NULL THEN RAISE EXCEPTION 'public.contents required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN RAISE EXCEPTION 'service_role required'; END IF;
  IF to_regclass('chalpick_private.cp_v12_installation') IS NULL AND EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='chalpick_private' AND c.relname IN ('social_accounts','social_content_activity','social_activity_history','social_activity_commands')) THEN
    RAISE EXCEPTION 'Unrecognized v12 objects; inspect before installing';
  END IF;
END $guard$;

CREATE TABLE IF NOT EXISTS chalpick_private.cp_v12_installation (
  version text PRIMARY KEY, installed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chalpick_private.social_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK(provider IN ('kakao','naver')),
  external_id text NOT NULL CHECK(length(external_id) BETWEEN 1 AND 128 AND external_id !~ '[[:cntrl:]]'),
  gender text CHECK(gender IN ('male','female')),
  birth_year smallint CHECK(birth_year BETWEEN 1900 AND 2200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,external_id)
);
CREATE TABLE IF NOT EXISTS chalpick_private.social_content_activity (
  account_id uuid NOT NULL REFERENCES chalpick_private.social_accounts(id) ON DELETE CASCADE,
  content_id integer NOT NULL REFERENCES public.contents(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK(status IN ('NONE','WATCHED','WANT_TO_WATCH','NOT_INTERESTED')),
  stars numeric CHECK(stars BETWEEN 0.5 AND 5 AND stars*2=trunc(stars*2)),
  version bigint NOT NULL CHECK(version>=1),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id,content_id),
  CHECK(status='WATCHED' OR stars IS NULL)
);
CREATE TABLE IF NOT EXISTS chalpick_private.social_activity_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES chalpick_private.social_accounts(id) ON DELETE CASCADE,
  content_id integer NOT NULL REFERENCES public.contents(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL, version bigint NOT NULL,
  before_status text NOT NULL, before_stars numeric,
  after_status text NOT NULL, after_stars numeric,
  title_snapshot text NOT NULL, media_snapshot text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(account_id,request_id), UNIQUE(account_id,content_id,version)
);
CREATE TABLE IF NOT EXISTS chalpick_private.social_activity_commands (
  account_id uuid NOT NULL REFERENCES chalpick_private.social_accounts(id) ON DELETE CASCADE,
  request_id uuid NOT NULL, payload jsonb NOT NULL, response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(account_id,request_id)
);
COMMENT ON TABLE chalpick_private.social_accounts IS 'Verified custom OAuth identities only. Never automatically merged by nickname, email, or client UUID.';
COMMENT ON TABLE chalpick_private.social_content_activity IS 'Current explicit user declaration. NONE tombstones preserve optimistic versions. Stars do not silently create legacy LIKE/DISLIKE.';
COMMENT ON TABLE chalpick_private.social_activity_history IS 'Append-only for application roles. occurred_at is time of recording, not the time a work was actually watched.';
CREATE INDEX IF NOT EXISTS cp_v12_accounts_demographics_idx ON chalpick_private.social_accounts(gender,birth_year);
CREATE INDEX IF NOT EXISTS cp_v12_activity_recent_idx ON chalpick_private.social_content_activity(account_id,updated_at DESC,content_id DESC) WHERE status<>'NONE';
CREATE INDEX IF NOT EXISTS cp_v12_activity_status_idx ON chalpick_private.social_content_activity(account_id,status,updated_at DESC,content_id DESC);
CREATE INDEX IF NOT EXISTS cp_v12_activity_content_idx ON chalpick_private.social_content_activity(content_id);
CREATE INDEX IF NOT EXISTS cp_v12_history_recent_idx ON chalpick_private.social_activity_history(account_id,id DESC);
CREATE INDEX IF NOT EXISTS cp_v12_history_content_idx ON chalpick_private.social_activity_history(content_id);

-- No table access for browser roles or service_role. Only the narrow, role-checked
-- private implementations can read/write these rows.
DO $tables$
DECLARE t text; columns text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cp_v12_installation','social_accounts','social_content_activity','social_activity_history','social_activity_commands'] LOOP
    EXECUTE format('ALTER TABLE chalpick_private.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE chalpick_private.%I FROM PUBLIC,anon,authenticated,service_role',t);
    SELECT string_agg(quote_ident(attname),',' ORDER BY attnum) INTO columns
      FROM pg_attribute WHERE attrelid=to_regclass('chalpick_private.'||t) AND attnum>0 AND NOT attisdropped;
    EXECUTE format('REVOKE ALL (%s) ON TABLE chalpick_private.%I FROM PUBLIC,anon,authenticated,service_role',columns,t);
  END LOOP;
END $tables$;
REVOKE ALL ON SEQUENCE chalpick_private.social_activity_history_id_seq FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION chalpick_private.cp_v12_require_identity(p_provider text,p_external_id text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Verified OAuth server only' USING ERRCODE='42501'; END IF;
  IF p_provider IS NULL OR p_provider NOT IN ('kakao','naver') OR p_external_id IS NULL
    OR length(p_external_id) NOT BETWEEN 1 AND 128 OR p_external_id ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Invalid verified identity' USING ERRCODE='22023';
  END IF;
END $fn$;

CREATE OR REPLACE FUNCTION chalpick_private.cp_v12_get_activity_impl(
  p_provider text,p_external_id text,p_view text,p_content_id integer,p_status text,p_limit integer,p_offset integer,p_before bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='4s' AS $fn$
DECLARE account uuid; result jsonb;
BEGIN
  PERFORM chalpick_private.cp_v12_require_identity(p_provider,p_external_id);
  IF p_view IS NULL OR p_view NOT IN ('item','current','history') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
    OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 10000 OR (p_before IS NOT NULL AND p_before<1)
    OR (p_status IS NOT NULL AND p_status NOT IN ('WATCHED','WANT_TO_WATCH','NOT_INTERESTED')) THEN
    RAISE EXCEPTION 'Invalid pagination' USING ERRCODE='22023';
  END IF;
  SELECT id INTO account FROM chalpick_private.social_accounts WHERE provider=p_provider AND external_id=p_external_id;
  IF p_view='item' THEN
    IF p_content_id IS NULL OR p_content_id<1 THEN RAISE EXCEPTION 'Invalid content' USING ERRCODE='22023'; END IF;
    SELECT jsonb_build_object('item',jsonb_build_object('content_id',c.id,'status',coalesce(a.status,'NONE'),
      'stars',a.stars,'version',coalesce(a.version,0),'updated_at',a.updated_at,'title',c.title,'media',c.media,'thumbnail_url',c.thumbnail_url))
      INTO result FROM public.contents c LEFT JOIN chalpick_private.social_content_activity a ON a.content_id=c.id AND a.account_id=account
      WHERE c.id=p_content_id;
    IF result IS NULL THEN RAISE EXCEPTION 'Content not found' USING ERRCODE='P0002'; END IF;
    RETURN result;
  ELSIF p_view='history' THEN
    RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY id DESC) FROM
      (SELECT id,content_id,before_status,before_stars,after_status,after_stars,title_snapshot,media_snapshot,occurred_at
       FROM chalpick_private.social_activity_history WHERE account_id=account AND (p_before IS NULL OR id<p_before)
       ORDER BY id DESC LIMIT p_limit+1) x),'[]'::jsonb));
  END IF;
  RETURN jsonb_build_object(
    'counts',(SELECT jsonb_build_object('watched',count(*) FILTER(WHERE status='WATCHED'),'want',count(*) FILTER(WHERE status='WANT_TO_WATCH'),
      'avoid',count(*) FILTER(WHERE status='NOT_INTERESTED'),'rated',count(stars)) FROM chalpick_private.social_content_activity WHERE account_id=account),
    'items',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY updated_at DESC,content_id DESC) FROM
      (SELECT a.content_id,a.status,a.stars,a.version,a.updated_at,c.title,c.media,c.thumbnail_url
       FROM chalpick_private.social_content_activity a JOIN public.contents c ON c.id=a.content_id
       WHERE a.account_id=account AND a.status<>'NONE' AND (p_status IS NULL OR a.status=p_status)
       ORDER BY a.updated_at DESC,a.content_id DESC LIMIT p_limit+1 OFFSET p_offset) x),'[]'::jsonb));
END $fn$;

CREATE OR REPLACE FUNCTION chalpick_private.cp_v12_set_activity_impl(
  p_provider text,p_external_id text,p_content_id integer,p_status text,p_stars numeric,p_expected_version bigint,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='4s' AS $fn$
DECLARE account uuid; old_row chalpick_private.social_content_activity%ROWTYPE;
  command chalpick_private.social_activity_commands%ROWTYPE; result jsonb; payload jsonb; current_version bigint;
  saved_at timestamptz; title_value text; media_value text; image_value text;
BEGIN
  PERFORM chalpick_private.cp_v12_require_identity(p_provider,p_external_id);
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED required' USING ERRCODE='0A000'; END IF;
  IF p_content_id IS NULL OR p_content_id<1 OR p_request_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0
    OR p_status IS NULL OR p_status NOT IN ('NONE','WATCHED','WANT_TO_WATCH','NOT_INTERESTED')
    OR (p_stars IS NOT NULL AND NOT (p_stars BETWEEN 0.5 AND 5 AND p_stars*2=trunc(p_stars*2)))
    OR (p_status<>'WATCHED' AND p_stars IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid status/stars/version' USING ERRCODE='22023';
  END IF;
  SELECT title,media,thumbnail_url INTO title_value,media_value,image_value FROM public.contents WHERE id=p_content_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Content not found' USING ERRCODE='P0002'; END IF;
  INSERT INTO chalpick_private.social_accounts(provider,external_id) VALUES(p_provider,p_external_id)
    ON CONFLICT(provider,external_id) DO NOTHING;
  -- Serializing one verified account protects first insert, deletion and replays.
  SELECT id INTO account FROM chalpick_private.social_accounts WHERE provider=p_provider AND external_id=p_external_id FOR UPDATE;
  payload:=jsonb_build_object('content_id',p_content_id,'status',p_status,'stars',p_stars,'expected_version',p_expected_version);
  SELECT * INTO command FROM chalpick_private.social_activity_commands WHERE account_id=account AND request_id=p_request_id;
  IF FOUND THEN
    IF command.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Request ID reused with another payload' USING ERRCODE='22023'; END IF;
    RETURN command.response;
  END IF;
  SELECT * INTO old_row FROM chalpick_private.social_content_activity WHERE account_id=account AND content_id=p_content_id FOR UPDATE;
  current_version:=coalesce(old_row.version,0);
  IF current_version<>p_expected_version THEN RAISE EXCEPTION 'Activity version conflict' USING ERRCODE='P0409'; END IF;
  IF coalesce(old_row.status,'NONE')=p_status AND old_row.stars IS NOT DISTINCT FROM p_stars THEN
    saved_at:=old_row.updated_at;
  ELSE
    saved_at:=clock_timestamp();
    INSERT INTO chalpick_private.social_content_activity(account_id,content_id,status,stars,version,created_at,updated_at)
      VALUES(account,p_content_id,p_status,p_stars,current_version+1,saved_at,saved_at)
      ON CONFLICT(account_id,content_id) DO UPDATE SET status=EXCLUDED.status,stars=EXCLUDED.stars,version=EXCLUDED.version,updated_at=EXCLUDED.updated_at;
    INSERT INTO chalpick_private.social_activity_history(account_id,content_id,request_id,version,before_status,before_stars,after_status,after_stars,title_snapshot,media_snapshot,occurred_at)
      VALUES(account,p_content_id,p_request_id,current_version+1,coalesce(old_row.status,'NONE'),old_row.stars,p_status,p_stars,title_value,media_value,saved_at);
    current_version:=current_version+1;
  END IF;
  result:=jsonb_build_object('item',jsonb_build_object('content_id',p_content_id,'status',p_status,'stars',p_stars,
    'version',current_version,'updated_at',saved_at,'title',title_value,'media',media_value,'thumbnail_url',image_value));
  INSERT INTO chalpick_private.social_activity_commands(account_id,request_id,payload,response) VALUES(account,p_request_id,payload,result);
  RETURN result;
END $fn$;

-- Verified demographic input comes only from the server's encrypted OAuth
-- session. Scores and history returned here stay inside the server process.
CREATE OR REPLACE FUNCTION chalpick_private.cp_v12_social_recommendation_profile_impl(
  p_provider text,p_external_id text,p_gender text,p_birth_year integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='4s' AS $fn$
DECLARE account uuid; current_year integer:=extract(year FROM current_date)::integer;
  band integer; cohort_rows jsonb:='[]'::jsonb; feedback_rows jsonb;
BEGIN
  PERFORM chalpick_private.cp_v12_require_identity(p_provider,p_external_id);
  IF (p_gender IS NOT NULL AND p_gender NOT IN ('male','female'))
    OR (p_birth_year IS NOT NULL AND (p_birth_year<greatest(1900,current_year-120) OR p_birth_year>current_year)) THEN
    RAISE EXCEPTION 'Invalid verified demographics' USING ERRCODE='22023';
  END IF;
  INSERT INTO chalpick_private.social_accounts(provider,external_id,gender,birth_year) VALUES(p_provider,p_external_id,p_gender,p_birth_year)
    ON CONFLICT(provider,external_id) DO UPDATE SET gender=EXCLUDED.gender,birth_year=EXCLUDED.birth_year
    RETURNING id INTO account;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY updated_at DESC,content_id DESC),'[]'::jsonb) INTO feedback_rows FROM
    (SELECT content_id,status,stars,updated_at FROM chalpick_private.social_content_activity
     WHERE account_id=account AND status IN ('NOT_INTERESTED','WATCHED')
     ORDER BY updated_at DESC,content_id DESC LIMIT 1000) x;
  band:=(current_year-p_birth_year)/10;
  IF p_gender IS NOT NULL AND p_birth_year IS NOT NULL AND band>=1 THEN
    WITH members AS MATERIALIZED (
      SELECT s.id FROM chalpick_private.social_accounts s WHERE s.gender=p_gender AND s.birth_year IS NOT NULL
        AND (current_year-s.birth_year)/10=band
        AND EXISTS(SELECT 1 FROM chalpick_private.social_content_activity a WHERE a.account_id=s.id AND a.status='WATCHED' AND a.stars IS NOT NULL)
    ), enough AS (SELECT count(*)>=10 AS allowed FROM members), ranked AS (
      SELECT a.content_id,count(*)::integer AS liked_count FROM chalpick_private.social_content_activity a JOIN members m ON m.id=a.account_id
      WHERE a.status='WATCHED' AND a.stars>=4 AND (SELECT allowed FROM enough)
      GROUP BY a.content_id HAVING count(*)>=3 ORDER BY liked_count DESC,a.content_id LIMIT 20
    ) SELECT coalesce(jsonb_agg(to_jsonb(ranked) ORDER BY liked_count DESC,content_id),'[]'::jsonb) INTO cohort_rows FROM ranked;
  END IF;
  RETURN jsonb_build_object('feedback',feedback_rows,'cohort',cohort_rows,'cohortStatus',CASE WHEN jsonb_array_length(cohort_rows)>=5 THEN 'ready' ELSE 'insufficient' END);
END $fn$;

CREATE OR REPLACE FUNCTION public.cp_v12_get_activity(
  p_provider text,p_external_id text,p_view text,p_content_id integer,p_status text,p_limit integer,p_offset integer,p_before bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
  SELECT chalpick_private.cp_v12_get_activity_impl(p_provider,p_external_id,p_view,p_content_id,p_status,p_limit,p_offset,p_before);
$fn$;
CREATE OR REPLACE FUNCTION public.cp_v12_set_activity(
  p_provider text,p_external_id text,p_content_id integer,p_status text,p_stars numeric,p_expected_version bigint,p_request_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
  SELECT chalpick_private.cp_v12_set_activity_impl(p_provider,p_external_id,p_content_id,p_status,p_stars,p_expected_version,p_request_id);
$fn$;
CREATE OR REPLACE FUNCTION public.cp_v12_social_recommendation_profile(p_provider text,p_external_id text,p_gender text,p_birth_year integer)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
  SELECT chalpick_private.cp_v12_social_recommendation_profile_impl(p_provider,p_external_id,p_gender,p_birth_year);
$fn$;
REVOKE ALL ON FUNCTION chalpick_private.cp_v12_require_identity(text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION chalpick_private.cp_v12_get_activity_impl(text,text,text,integer,text,integer,integer,bigint),
  chalpick_private.cp_v12_set_activity_impl(text,text,integer,text,numeric,bigint,uuid),
  public.cp_v12_get_activity(text,text,text,integer,text,integer,integer,bigint),
  public.cp_v12_set_activity(text,text,integer,text,numeric,bigint,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION chalpick_private.cp_v12_social_recommendation_profile_impl(text,text,text,integer),
  public.cp_v12_social_recommendation_profile(text,text,text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA chalpick_private TO service_role;
GRANT EXECUTE ON FUNCTION chalpick_private.cp_v12_get_activity_impl(text,text,text,integer,text,integer,integer,bigint),
  chalpick_private.cp_v12_set_activity_impl(text,text,integer,text,numeric,bigint,uuid),
  public.cp_v12_get_activity(text,text,text,integer,text,integer,integer,bigint),
  public.cp_v12_set_activity(text,text,integer,text,numeric,bigint,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION chalpick_private.cp_v12_social_recommendation_profile_impl(text,text,text,integer),
  public.cp_v12_social_recommendation_profile(text,text,text,integer) TO service_role;
INSERT INTO chalpick_private.cp_v12_installation(version) VALUES('social-activity-v12.1') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
