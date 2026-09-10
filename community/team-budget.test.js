import test from 'node:test';
import assert from 'node:assert/strict';
import { teamGitHub, observeTeam } from './team-github.js';
import { emptyTeam, transitionTeam } from './team.js';
const base='a'.repeat(40), tip='c'.repeat(40), repo='example/repo';
const file=x=>({type:'file',encoding:'base64',size:Buffer.byteLength(JSON.stringify(x)),content:Buffer.from(JSON.stringify(x)).toString('base64')});
for (const count of [13,20]) test(`bounded observation makes fair saved progress across ${count} tasks`, async () => {
 let state=emptyTeam(7), reads=0,writes=0; let savedState, pendingState;
 const policy={team:{enabled:true,maxActive:20},protectedPaths:{block:[],requireApproval:[]},evidence:{requiredChecks:[{name:'Behavior',appSlug:'github-actions',workflowPath:'.github/workflows/ci.yml'}]}};
 const prs=new Map();
 for(let i=1;i<=count;i++){
  const id=`task-${i}`,head=i.toString(16).padStart(40,'0');
  state=transitionTeam(state,{action:'plan',tasks:[{id,title:id,paths:[`src/${id}.js`]}]});
  state=transitionTeam(state,{action:'claim',task:id,owner:id},{baseSha:base,policySha:base,maxActive:20});
  state=transitionTeam(state,{action:'bind',task:id,pullRequest:i},{headSha:head});
  prs.set(i,{id:100+i,number:i,state:'open',merged:false,merge_commit_sha:null,changed_files:1,draft:false,mergeable:true,head:{sha:head,ref:`changeplane/work/${id}-1`,repo:{id:7,full_name:repo}},base:{sha:base,ref:'main',repo:{id:7,full_name:repo}}});
 }
 const fetchImpl=async(url,options)=>{
  const path=new URL(url).pathname.replace('/repos/'+repo,''), q=new URL(url).searchParams;
  let value;
  if(options.method==='GET'){
   reads++;
   if(path==='')value={id:7,full_name:repo,default_branch:'main'};
   else if(path==='/commits/main')value={sha:base};
   else if(path==='/contents/.changeplane.json')value=file(policy);
   else if(path==='/git/ref/heads/changeplane/team-state')value={ref:'refs/heads/changeplane/team-state',object:{type:'commit',sha:tip}};
   else if(path==='/contents/team.json')value=file(savedState ?? state);
   else if(path.startsWith('/git/commits/'))value={tree:{sha:'f'.repeat(40)}};
   else if(/\/pulls\/\d+\/(reviews|comments)$/.test(path))value=[];
   else if(/^\/pulls\/\d+$/.test(path))value=prs.get(Number(path.split('/')[2]));
   else if(/^\/pulls\/\d+\/files$/.test(path))value=[{filename:`src/task-${path.split('/')[2]}.js`,status:'modified'}];
   else if(path==='/actions/runs') {const n=parseInt(q.get('head_sha'),16);value={total_count:1,workflow_runs:[{id:n,workflow_id:12,run_number:n,run_attempt:1,head_sha:q.get('head_sha'),path:'.github/workflows/ci.yml',status:'completed',conclusion:'success',repository:{full_name:repo},head_repository:{full_name:repo}}]};}
   else if(/^\/actions\/runs\/\d+\/attempts\/1\/jobs$/.test(path)){const n=Number(path.split('/')[3]);value={total_count:1,jobs:[{id:200+n,run_id:n,head_sha:prs.get(n).head.sha,name:'Behavior',status:'completed',conclusion:'success'}]};}
   else if(path.startsWith('/compare/'))value={status:'ahead'};
   else throw new Error('unexpected '+path);
  }else {writes++; if(path==='/git/trees')pendingState=JSON.parse(JSON.parse(options.body).tree.find(item=>item.path==='team.json').content); if(path.includes('/git/refs'))savedState=pendingState; value=path.includes('/git/refs')?{ref:'refs/heads/changeplane/team-state',object:{sha:'e'.repeat(40)}}:{sha:'e'.repeat(40)};}
  return new Response(JSON.stringify(value),{status:200});
 };
 const seen=new Set();
 for(let sweep=0;sweep<6 && seen.size<count;sweep++) {
  reads=0; writes=0;
  const result=await observeTeam({createApi:()=>teamGitHub({repository:repo,token:'synthetic',writeEnabled:true,fetchImpl}),sleep:async()=>{}});
  assert.ok(['observed','partial'].includes(result.observerStatus));
  for(const observation of result.observations.filter(item=>!['deferred','unavailable'].includes(item.state))) seen.add(observation.task);
  assert.ok(reads<=200); assert.equal(writes,3,'partial progress must persist');
  for(const task of result.tasks.filter(item=>item.observationStatus==='deferred')) assert.equal(task.handoff,null,'unobserved task cannot expose an old handoff');
 }
 assert.equal(seen.size,count,'later tasks must not starve');
});
