if(typeof PerformanceObserver!=='undefined'){
  for(const type of ['paint','largest-contentful-paint']){
    try{
      const observer=new PerformanceObserver(list=>{
        for(const entry of list.getEntries()){
          if(entry.name==='first-contentful-paint')document.documentElement.dataset.firstPaintMs=String(Math.round(entry.startTime));
          if(entry.entryType==='largest-contentful-paint')document.documentElement.dataset.largestPaintMs=String(Math.round(entry.startTime));
        }
      });
      observer.observe({type,buffered:true});
    }catch{}
  }
}
