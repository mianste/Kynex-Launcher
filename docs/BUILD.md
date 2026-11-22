# Windows 构建与验收

开发机需要 JDK 21、Node.js 22、pnpm 11.25.0、Maven、Python 3.12 和 WebView2 Runtime。打包覆盖更新还需要 NSIS。发布包自带 Java 运行环境。

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
mvn -B -f src-java/pom.xml test dependency:copy-dependencies -DoutputDirectory=target/desktop-deps
$deps = "src-java/target/desktop-deps"
python scripts/build_java_desktop.py --jdk "$env:JAVA_HOME" --gson-jar "$deps/gson-2.13.2.jar" --swt-jar "$deps/org.eclipse.swt.win32.win32.x86_64-3.131.0.jar" --jna-jar "$deps/jna-5.17.0.jar" --leveldb-jar "$deps/leveldb-0.12-uber.jar" --bouncy-jar "$deps/bcprov-jdk18on-1.85.jar" --output build/windows
```

用 `pnpm dev` 查看网页预览。Windows 应用位于 `build/windows/Kynex Launcher Source`，双击其中的 `Kynex Launcher Source.exe` 即可启动。公开源码版使用自己的数据目录。

微软登录需要在账号页填写自己的应用编号。CurseForge 官方接口密钥可以在设置中填写。
