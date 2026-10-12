(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MenuSuiteTaskState=api;})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const completed=new Set(['completed','tamamlandi','tamamlandı']);
  const cancelled=new Set(['cancelled','iptal_edildi','archived']);
  function assignment(task,userId){return (task.assignments||[]).find(a=>!userId||String(a.userId)===String(userId))||{status:'pending'};}
  function active(task,userId){if(userId&&!(task.assignments||[]).some(a=>String(a.userId)===String(userId)))return false;const a=assignment(task,userId);return !cancelled.has(task.workflowStatus||task.status)&&!cancelled.has(a.status)&&!completed.has(a.status);}
  function count(tasks,userId){return (Array.isArray(tasks)?tasks:[]).filter(t=>active(t,userId)).length;}
  return Object.freeze({active,count});
});
