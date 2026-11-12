import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe,it,expect,vi} from "vitest";
vi.mock("../src/store",()=>({useStore:()=>({})}));
vi.mock("../src/lib/bridge",()=>({desktop:false,api:vi.fn(),readableSize:(n:number)=>`${n} B`}));
import {PlanCard} from "../src/features/assistant/AgentPanel";
import type {PackPlan} from "../src/features/assistant/agentStore";
describe("workshop plan card",()=>{it("renders the plan overview and entry points safely",()=>{const plan:PackPlan={version:1,name:"冒险包<script>",minecraft:"1.20.1",loader:{type:"fabric",version:"0.16.9"},memoryMb:4096,java:"auto",mods:[{source:"modrinth",projectId:"real-project",versionId:"real-version",name:"地图",side:"client",reason:"减少迷路",required:true}],resourcePacks:[],shaders:[],localization:{mode:"none",note:""},options:{language:"zh_cn"},configPatches:[],notes:["先查看计划"],estimatedDownloadBytes:1024,warnings:["下载量包含前置"]};const html=renderToStaticMarkup(<PlanCard plan={plan}/>);expect(html).toContain("查看模组清单（1）");expect(html).toContain("资源、汉化和配置详情");expect(html).toContain("4096 MB");expect(html).not.toContain("<details");expect(html).toContain("下载量包含前置");expect(html).toContain("&lt;script&gt;");expect(html).not.toContain("<script>");});});
