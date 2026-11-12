use crate::*;
use serde::Deserialize;
#[derive(Deserialize,serde::Serialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]pub struct Template{pub id:String,pub name:String,pub description:String,pub minecraft:String,pub loader:String,pub memory_mb:u64,pub mod_queries:Vec<String>,pub options:Value}
pub fn parse(text:&str)->Result<Template>{let t:Template=serde_json::from_str(text).map_err(|_|"模板格式无效")?;safe_name(&t.id)?;if t.name.is_empty()||t.mod_queries.len()>4||!(512..=65536).contains(&t.memory_mb)||!["vanilla","fabric","quilt","forge","neoforge"].contains(&t.loader.as_str()){return Err("模板内容超过范围或预算".into());}for q in &t.mod_queries{if q.len()>120||q.contains(['\n','\r']){return Err("模板查询词无效".into());}}if let Some(options)=t.options.as_object(){for(k,v)in options{super::config_patch::check_option(k,v)?;}}else{return Err("模板选项须为对象".into());}Ok(t)}
pub fn list()->Vec<Template>{[include_str!("../../../config/pack-templates/vanilla-plus.json"),include_str!("../../../config/pack-templates/adventure.json"),include_str!("../../../config/pack-templates/technology.json"),include_str!("../../../config/pack-templates/magic.json"),include_str!("../../../config/pack-templates/skyblock.json"),include_str!("../../../config/pack-templates/building.json"),include_str!("../../../config/pack-templates/horror.json"),include_str!("../../../config/pack-templates/server.json")].into_iter().filter_map(|s|parse(s).ok()).collect()}
pub fn apply(id: &str) -> Result<Value> {
    let template = list().into_iter().find(|item| item.id == id).ok_or("找不到这份模板，请换一个试试。")?;
    let mut request = format!(
        "我想做一个{}整合包，用 Minecraft {} 和 {}，给游戏分配 {} MB 内存。\n{}",
        template.name, template.minecraft, template.loader, template.memory_mb, template.description
    );
    if !template.mod_queries.is_empty() {
        request.push_str(&format!("\n想试试这些模组：{}。", template.mod_queries.join("、")));
    }
    if template.options["language"] == "zh_cn" {
        request.push_str("\n游戏语言用简体中文。");
    }
    if let Some(distance) = template.options["renderDistance"].as_u64() {
        request.push_str(&format!("视野距离设为 {distance} 个区块。"));
    }
    Ok(json!({"template": template, "request": request, "note": "你可以先改一改，再让助手给出方案。"}))
}
#[cfg(test)]mod tests{use super::*;#[test]fn validates_templates_without_fixed_ids(){let all=list();assert_eq!(all.len(),8);assert!(parse("{}").is_err());assert!(parse(r#"{"id":"x","name":"x","description":"","minecraft":"1.20.1","loader":"shell","memoryMb":4096,"modQueries":[],"options":{}}"#).is_err());assert!(apply("adventure").unwrap()["request"].as_str().unwrap().contains("我想做一个"));for t in all{assert!(!serde_json::to_string(&t).unwrap().contains("projectId"));}}}
