import {describe,it,expect,beforeEach} from "vitest";
import {useAgent,isBuildRequest,type AgentTask} from "../src/features/assistant/agentStore";
const task=(status="planning"):AgentTask=>({id:"test",mode:"confirm",status,request:"制作整合包",plan:null,planHash:"hash",steps:[],currentStep:0,budget:{},audit:[],createdAt:"1",updatedAt:"1",error:"",directoryId:"default",instanceId:"instance",snapshots:[],confirmedHash:"",rollbackSnapshot:""});
describe("agentStore",()=>{
 beforeEach(()=>useAgent.setState({tasks:[],selected:"",error:"",progress:{}}));
 it("tracks plans, steps, failure and cancellation without duplicating tasks",()=>{const s=useAgent.getState();s.receive({taskId:"test",type:"state",task:task()});expect(useAgent.getState().selected).toBe("test");s.receive({taskId:"test",type:"step",task:{...task("executing"),currentStep:2,steps:[{name:"安装",status:"running",elapsedMs:0,detail:"",snapshotId:""}]}});expect(useAgent.getState().tasks).toHaveLength(1);expect(useAgent.getState().tasks[0].currentStep).toBe(2);s.receive({taskId:"test",type:"error",task:{...task("failed"),error:"预算不足"}});expect(useAgent.getState().tasks[0].error).toBe("预算不足");s.receive({taskId:"test",type:"state",task:task("cancelled")});expect(useAgent.getState().tasks[0].status).toBe("cancelled");});
 it("keeps task selection and records host progress",()=>{const s=useAgent.getState();s.replace([task()]);s.receive({taskId:"test",type:"progress",stage:"下载",done:5,total:10});expect(useAgent.getState().progress.test.stage).toBe("下载");s.fail("范围拒绝");expect(useAgent.getState().error).toBe("范围拒绝");});
 it("drops deleted records even if a queued event arrives", () => {
  const store = useAgent.getState();
  const removed = { ...task("done"), id: "removed" };
  store.replace([removed, task()]);
  store.remove(removed.id);
  store.receive({ taskId: removed.id, type: "state", task: removed });
  expect(useAgent.getState().tasks.map((task) => task.id)).toEqual(["test"]);
  expect(useAgent.getState().selected).toBe("test");
 });
 it("recognizes building while preserving ordinary consultant questions",()=>{expect(isBuildRequest("做一个1.20.1 Fabric轻量冒险包")).toBe(true);expect(isBuildRequest("帮我创建整合包")).toBe(true);expect(isBuildRequest("想制作整合包，推荐哪些模组")).toBe(false);expect(isBuildRequest("如何制作整合包")).toBe(false);});
});
