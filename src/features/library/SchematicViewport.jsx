import { useEffect, useRef, useState } from "react";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import {
  Box3,
  GridHelper,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Button } from "../../components/ui";
import {
  buildSchematicMesh,
  materialColor,
  readCells,
} from "./schematicGeometry";
import { texturedSchematic } from "./minecraftAppearance";
import { renderSchematicEntities } from "./schematicEntityModels";
function topView(host, model, cells) {
  const [width, height, depth] = model.grid;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = depth;
  const context = canvas.getContext("2d");
  if (!context) return;
  const colors = model.palette.map(materialColor);
  for (let z = 0; z < depth; z++) {
    for (let x = 0; x < width; x++) {
      for (let y = height - 1; y >= 0; y--) {
        const cell = cells[x + width * (z + depth * y)];
        if (!cell) continue;
        context.fillStyle = colors[cell];
        context.fillRect(x, z, 1, 1);
        break;
      }
    }
  }
  canvas.className = "schematic-top-view";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "建筑俯视图");
  host.replaceChildren(canvas);
}
export default function SchematicViewport({ model, appearance }) {
  const host = useRef(null);
  const cameraActions = useRef();
  const [flat, Flat] = useState(false);
  const [error, ErrorText] = useState("");
  const [status, Status] = useState("");
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let cells;
    try {
      cells = readCells(model);
    } catch (reason) {
      ErrorText(String(reason).replace(/^Error: /, ""));
      return;
    }
    const canvas = document.createElement("canvas");
    let renderer;
    try {
      const context = canvas.getContext("webgl2", {
        alpha: true,
        antialias: true,
      });
      if (!context) throw new Error("WebGL2");
      renderer = new WebGLRenderer({
        canvas,
        context,
        alpha: true,
        antialias: true,
      });
    } catch {
      Flat(true);
      topView(element, model, cells);
      return () => element.replaceChildren();
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    canvas.tabIndex = 0;
    canvas.setAttribute(
      "aria-label",
      "建筑 3D 预览，拖动旋转，右键拖动平移，滚轮缩放",
    );
    element.replaceChildren(canvas);
    const [width, height, depth] = model.grid;
    const size = new Vector3(width, height, depth);
    let radius = size.length() / 2;
    const pivot = new Vector3(0, height / 2, 0);
    const facing = new Vector3(1, 0.78, 1.14).normalize();
    const camera = new PerspectiveCamera(
      38,
      1,
      Math.max(0.01, radius * 0.002),
      radius * 40,
    );
    camera.position.copy(pivot).addScaledVector(facing, radius * 4);
    const controls = new OrbitControls(camera, canvas);
    controls.target.copy(pivot);
    controls.minDistance = Math.max(1, radius * 0.015);
    controls.maxDistance = radius * 20;
    controls.maxPolarAngle = Math.PI * 0.94;
    controls.listenToKeyEvents(canvas);
    const scene = new Scene();
    const grid = new GridHelper(
      Math.max(width, depth) * 1.55,
      18,
      0x627e86,
      0x91a0a8,
    );
    grid.material.transparent = true;
    grid.material.opacity = 0.32;
    grid.position.y = -0.06;
    scene.add(grid);
    const direction = new Vector3();
    let sortTransparency;
    const render = () => {
      sortTransparency?.(camera.getWorldDirection(direction));
      renderer.render(scene, camera);
    };
    const resize = () => {
      if (!element.clientWidth || !element.clientHeight) return;
      renderer.setSize(element.clientWidth, element.clientHeight, false);
      camera.aspect = element.clientWidth / element.clientHeight;
      camera.updateProjectionMatrix();
      render();
    };
    const reset = () => {
      const halfFov = (camera.fov * Math.PI) / 360;
      const fittingFov = Math.min(
        halfFov,
        Math.atan(Math.tan(halfFov) * camera.aspect),
      );
      controls.target.copy(pivot);
      camera.position
        .copy(pivot)
        .addScaledVector(facing, (radius * 1.08) / Math.sin(fittingFov));
      controls.update();
      render();
    };
    cameraActions.current = {
      reset,
      zoom: (factor) => {
        const direction = camera.position.clone().sub(controls.target);
        const distance = Math.min(
          controls.maxDistance,
          Math.max(controls.minDistance, direction.length() * factor),
        );
        camera.position
          .copy(controls.target)
          .addScaledVector(direction.normalize(), distance);
        controls.update();
      },
    };
    controls.addEventListener("change", render);
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    reset();
    let active = true;
    let disposeModel;
    Status(appearance ? "正在绘制方块…" : "");
    const textured = appearance
      ? texturedSchematic(model, cells, appearance).then((rendered) => ({
          rendered,
          tooDetailed: !rendered,
        }))
      : Promise.resolve({ rendered: undefined, tooDetailed: false });
    const figures = appearance
      ? renderSchematicEntities(model, cells, appearance).catch(() => undefined)
      : undefined;
    void Promise.all([
      textured.catch(() => ({ rendered: undefined, tooDetailed: false })),
      figures,
    ])
      .then(([{ rendered, tooDetailed }, entities]) => {
        if (!active) {
          rendered?.geometry.dispose();
          rendered?.texture.dispose();
          entities?.dispose();
          return;
        }
        const geometry =
          rendered?.geometry ??
          buildSchematicMesh(model.grid, model.palette, cells);
        const opaque = new MeshBasicMaterial({
          map: rendered?.texture,
          vertexColors: true,
          alphaTest: 0.15,
        });
        const clear =
          rendered &&
          new MeshBasicMaterial({
            map: rendered.texture,
            vertexColors: true,
            transparent: true,
            alphaTest: 0.08,
            depthWrite: false,
          });
        const building = new Mesh(geometry, clear ? [opaque, clear] : opaque);
        building.position.set(-width / 2, 0, -depth / 2);
        scene.add(building);
        if (entities?.group.children.length) {
          scene.add(entities.group);
          const bounds = new Box3(
            new Vector3(-width / 2, 0, -depth / 2),
            new Vector3(width / 2, height, depth / 2),
          );
          bounds.expandByObject(entities.group).getCenter(pivot);
          radius = bounds.getSize(size).length() / 2;
          controls.maxDistance = radius * 20;
          camera.far = radius * 40;
          camera.updateProjectionMatrix();
          reset();
        }
        sortTransparency = rendered?.sortTransparency;
        const hasTextures =
          appearance &&
          (Object.keys(appearance.textures).length > 0 ||
            entities?.group.children.length);
        const blockStatus =
          rendered && hasTextures
            ? `原版纹理 · Minecraft ${appearance?.version}${rendered.incomplete ? " · 部分方块简化显示" : ""}`
            : tooDetailed
              ? "投影细节较多 · 简化显示"
              : "原版纹理暂不可用 · 简化显示";
        const total = model.entities?.length ?? 0;
        const visible = entities?.visible ?? 0;
        Status(
          total
            ? `${blockStatus} · 已显示 ${visible}/${total} 个实体${visible < total ? "，部分实体缺少预览模型" : ""}`
            : blockStatus,
        );
        render();
        disposeModel = () => {
          geometry.dispose();
          rendered?.texture.dispose();
          entities?.dispose();
          opaque.dispose();
          clear?.dispose();
        };
      })
      .catch(() => {
        if (active) ErrorText("无法绘制此投影的方块");
      });
    return () => {
      active = false;
      cameraActions.current = undefined;
      observer.disconnect();
      controls.dispose();
      disposeModel?.();
      grid.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      element.replaceChildren();
    };
  }, [model, appearance]);
  return (
    <>
      <div className="schematic-viewport" ref={host}>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
      </div>
      {flat ? (
        <p className="schematic-viewport-help">当前设备显示建筑俯视图。</p>
      ) : (
        !error && (
          <div className="schematic-viewport-tools">
            <span className="schematic-viewport-help">
              拖动旋转 · 右键拖动平移 · 滚轮缩放
            </span>
            <Button
              onClick={() => cameraActions.current?.zoom(0.8)}
              aria-label="放大"
              title="放大"
            >
              <ZoomIn size={16} />
            </Button>
            <Button
              onClick={() => cameraActions.current?.zoom(1.25)}
              aria-label="缩小"
              title="缩小"
            >
              <ZoomOut size={16} />
            </Button>
            <Button onClick={() => cameraActions.current?.reset()}>
              <RotateCcw size={15} /> 重置视角
            </Button>
          </div>
        )
      )}
      {!flat && !error && status && (
        <p
          className="schematic-viewport-help schematic-viewport-status"
          role="status"
        >
          {status}
        </p>
      )}
    </>
  );
}
