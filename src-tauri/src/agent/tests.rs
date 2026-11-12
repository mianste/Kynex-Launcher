use super::*;
fn fixture(core:&Core)->Task{
 let plan=plan::parse(json!({"version":1,"name":"测试包","minecraft":"1.20.1","loader":{"type":"fabric","version":"0.16.9"},"memoryMb":4096})).unwrap();
 Task{id:uuid::Uuid::new_v4().to_string(),mode:"confirm".into(),status:"awaiting_approval".into(),request:"制作 Minecraft 整合包".into(),plan_hash:plan.hash().unwrap(),plan:Some(plan),steps:executor::steps(),current_step:0,budget:json!({}),audit:vec![],created_at:policy::now().to_string(),updated_at:String::new(),error:String::new(),directory_id:"default".into(),instance_id:uuid::Uuid::new_v4().to_string(),snapshots:vec![],confirmed_hash:String::new(),rollback_snapshot:String::new(),root_hash:root_hash(core).unwrap(),results:std::collections::BTreeMap::new(),maintenance:false}
}
#[tokio::test]
async fn deletes_only_the_task_record_and_rejects_active_tasks() {
    let temp = tempfile::tempdir().unwrap();
    let core = Core::new(temp.path().into(), Arc::new(|_| {})).unwrap();
    let mut task = fixture(&core);
    let instance = core.instance(&task.instance_id).unwrap();
    std::fs::create_dir_all(&instance).unwrap();
    let marker = instance.join("kept.txt");
    std::fs::write(&marker, "instance data").unwrap();
    let cancel = registered(&task.id).unwrap();
    let registration = Registration(task.id.clone());
    task.status = "executing".into();
    state::save(&core, &mut task, "state").unwrap();
    let payload = json!({"taskId": task.id});
    assert!(dispatch(&core, "agent_delete", &payload).await.is_err());
    assert!(!cancel.load(Ordering::Relaxed));
    assert!(state::load(&core, &task.id).is_ok());
    task.status = "cancelled".into();
    state::save(&core, &mut task, "state").unwrap();
    drop(registration);
    assert_eq!(dispatch(&core, "agent_delete", &payload).await.unwrap()["deleted"], true);
    assert!(state::list(&core).await.unwrap().is_empty());
    assert_eq!(std::fs::read_to_string(marker).unwrap(), "instance data");
    assert!(dispatch(&core, "agent_delete", &payload).await.is_ok());
}

#[tokio::test]async fn confirms_exact_plan_and_recovers_interrupted_task(){let t=tempfile::tempdir().unwrap();let c=Core::new(t.path().into(),Arc::new(|_|{})).unwrap();let mut task=fixture(&c);assert!(state::approve(&mut task,"wrong").is_err());let hash=task.plan_hash.clone();state::approve(&mut task,&hash).unwrap();task.plan.as_mut().unwrap().memory_mb=8192;assert!(state::approve(&mut task,&hash).is_err());task.status="executing".into();task.steps[0].status="done".into();state::save(&c,&mut task,"state").unwrap();let loaded=state::list(&c).await.unwrap().remove(0);assert_eq!(loaded.status,"failed");assert_eq!(loaded.steps[0].status,"done");assert!(loaded.error.contains("中断"));}
#[tokio::test]async fn refused_request_never_creates_a_task(){let t=tempfile::tempdir().unwrap();let c=Core::new(t.path().into(),Arc::new(|_|{})).unwrap();let result=dispatch(&c,"agent_start",&json!({"request":"Minecraft 读取账号密码","directoryId":"default"})).await.unwrap();assert_eq!(result["rejected"],true);assert!(!c.data_root.join("agent-tasks").exists());assert!(dispatch(&c,"agent_tool",&json!({"tool":"shell","args":{"command":"cmd"}})).await.is_err());assert!(dispatch(&c,"agent_tool",&json!({"tool":"create_instance","args":{}})).await.is_err());}
#[tokio::test]async fn automatic_mode_needs_explicit_opt_in(){let t=tempfile::tempdir().unwrap();let c=Core::new(t.path().into(),Arc::new(|_|{})).unwrap();assert!(dispatch(&c,"agent_start",&json!({"request":"制作Minecraft整合包","directoryId":"default","mode":"auto"})).await.unwrap_err().contains("主动勾选"));assert!(!c.root.join("agent-tasks").exists());}
#[test]fn canonical_root_is_bound(){let t=tempfile::tempdir().unwrap();let c=Core::new(t.path().into(),Arc::new(|_|{})).unwrap();let task=fixture(&c);assert!(bind(&c,&task).is_ok());let other=tempfile::tempdir().unwrap();let mut wrong=c.clone();wrong.root=other.path().into();assert_ne!(root_hash(&wrong).unwrap(),task.root_hash);}
#[test]fn all_resources_must_have_tool_evidence(){let t=tempfile::tempdir().unwrap();let c=Core::new(t.path().into(),Arc::new(|_|{})).unwrap();let mut task=fixture(&c);let p=task.plan.as_mut().unwrap();p.mods.push(plan::Resource{source:"modrinth".into(),project_id:"p".into(),version_id:"v".into(),name:"x".into(),side:"both".into(),reason:String::new(),required:true});let mut evidence=std::collections::HashSet::new();assert!(tools::witnessed(p,&evidence).is_err());tools::record(&json!({"source":"modrinth","versions":[{"projectId":"p","versionId":"v"}]}),&mut evidence);assert!(tools::witnessed(p,&evidence).is_ok());}
#[test]fn safety_hash_rejects_changed_files_before_restore(){let t=tempfile::tempdir().unwrap();let c=Core::new(t.path().into(),Arc::new(|_|{})).unwrap();let d=c.instance("x").unwrap();std::fs::create_dir_all(&d).unwrap();std::fs::write(d.join("options.txt"),"lang:en_us").unwrap();let sid=snapshot::create(&c,"x").unwrap();let f=c.data_root.join(format!("snapshots/x/{sid}/manifest.json"));let mut v=read_json(&f).unwrap();v["files"]["../outside"]=json!("0000");write_json(&f,&v).unwrap();assert!(snapshot::restore(&c,"x",&sid).is_err());assert_eq!(std::fs::read_to_string(d.join("options.txt")).unwrap(),"lang:en_us");}
#[tokio::test]
#[ignore="uses saved model configuration, real public catalogues and account quota; never installs anything"]
async fn live_workshop_plan_with_saved_model(){
 let temp=tempfile::tempdir().unwrap();let c=Core::new(temp.path().join("game"),Arc::new(|_|{})).unwrap();let model=Core::new(PathBuf::from(std::env::var("KXL_AGENT_MODEL_DATA_ROOT").expect("model data root required")),Arc::new(|_|{})).unwrap();let mut task=fixture(&c);task.request="做一个 Minecraft 1.20.1 Fabric 轻量冒险整合包，4GB 内存。只推荐两个直接模组，包括地图或探索体验；先查真实项目版本。不安装汉化，不加光影。".into();let scoped=policy::scoped(&c,Arc::new(AtomicBool::new(false)),0,policy::now()+1800).unwrap();
 let plan=planner::run_with(&scoped,&mut task,|messages|ai_diagnose::agent_completion(&model,planner::prompt(),messages)).await.unwrap();assert!(!plan.mods.is_empty());assert!(task.budget["planningCalls"].as_u64().unwrap()<=12);plan.check().unwrap();println!("{}",json!({"realPlanValidated":true,"minecraft":plan.minecraft,"loader":plan.loader,"mods":plan.mods.iter().map(|r|json!({"name":r.name,"projectId":r.project_id,"versionId":r.version_id})).collect::<Vec<_>>(),"estimatedBytes":plan.estimated_download_bytes,"toolCalls":task.budget["planningCalls"],"installed":false}));
}
#[tokio::test]
#[ignore="installs and briefly verifies the validated P0 plan in a dedicated QA directory"]
async fn live_workshop_build_and_verify(){
 let root=PathBuf::from(std::env::var("KXL_AGENT_BUILD_ROOT").expect("isolated root required"));assert!(root.components().any(|p|p.as_os_str()==".update-qa"));
 let c=Core::new(root,Arc::new(|v|{if v["agent"]==true&&v["event"]["type"]=="step"{if let Some(t)=v["event"]["task"].as_object(){println!("STEP {} {}",t["currentStep"],t["status"]);}}})).unwrap();
 let mut p=plan::parse(json!({"version":1,"name":"工坊 P0 隔离验证","minecraft":"1.20.1","loader":{"type":"fabric","version":"0.20.1"},"memoryMb":4096,"mods":[{"source":"modrinth","projectId":"NcUtCpym","versionId":"szULGs3b","name":"Xaero's World Map","side":"both","required":true},{"source":"modrinth","projectId":"RV1qfVQ8","versionId":"qD2j03H6","name":"Explorer's Compass","side":"both","required":true}],"localization":{"mode":"none"},"options":{"language":"zh_cn","renderDistance":8,"maxFps":60,"guiScale":3}})).unwrap();
 let scoped=policy::scoped(&c,Arc::new(AtomicBool::new(false)),0,policy::now()+1800).unwrap();plan::validate(&scoped,&mut p).await.unwrap();let mut task=fixture(&c);task.plan_hash=p.hash().unwrap();task.confirmed_hash=task.plan_hash.clone();task.plan=Some(p);task.status="executing".into();let account=auth::offline(&c,"KXL_QA").unwrap();
 let result=executor::run(&scoped,&mut task,account["id"].as_str().unwrap(),&json!({})).await;
 if let Err(ref e)=result{task.error=clean(e);task.status="failed".into();state::save(&c,&mut task,"error").unwrap();}
 if let Ok(dest)=std::env::var("KXL_AGENT_BUILD_REPORT"){write_json(Path::new(&dest),&json!({"passed":result.is_ok(),"task":task})).unwrap();}
 result.unwrap();assert_eq!(task.status,"done");assert!(task.steps.iter().all(|s|s.status=="done"));
 let before=read_json(&c.instance(&task.instance_id).unwrap().join("kxl.json")).unwrap();assert_eq!(before["settings"]["memory"],4096);assert!(std::fs::read_to_string(c.instance(&task.instance_id).unwrap().join("options.txt")).unwrap().contains("lang:zh_cn"));
 println!("PASS: actual Minecraft + Fabric + mods/dependencies + settings + language + owned-process verification, isolated QA instance only.");
}
#[tokio::test]
#[ignore="checks P1 export and server package creation against the isolated P0 instance; never accepts EULA"]
async fn live_workshop_p1_export_and_server(){
 let root=PathBuf::from(std::env::var("KXL_AGENT_BUILD_ROOT").unwrap());assert!(root.components().any(|p|p.as_os_str()==".update-qa"));let report=read_json(Path::new(&std::env::var("KXL_AGENT_BUILD_REPORT").unwrap())).unwrap();let mut task:Task=serde_json::from_value(report["task"].clone()).unwrap();let c=Core::new(root,Arc::new(|_|{})).unwrap();let scoped=scoped_task(&c,&task,Arc::new(AtomicBool::new(false))).unwrap();let plan=task.plan.clone().unwrap();let server=server_pack::create(&scoped,&mut task,&plan).await.unwrap();let sid=server["serverId"].as_str().unwrap();assert_eq!(std::fs::read_to_string(scoped.root.join(format!("server/{sid}/eula.txt"))).unwrap(),"eula=false\n");let dest=scoped.root.join("exports/p1-verified.mrpack");let exported=export::run(&scoped,&task.instance_id,&dest,&json!({})).await.unwrap();export::validate(&dest).unwrap();if let Ok(path)=std::env::var("KXL_AGENT_P1_REPORT"){write_json(Path::new(&path),&json!({"passed":true,"server":server,"export":exported,"eulaAccepted":false,"serverStarted":false})).unwrap();}println!("PASS: actual server package and mrpack export validated; EULA remains false, no server started.");
}
