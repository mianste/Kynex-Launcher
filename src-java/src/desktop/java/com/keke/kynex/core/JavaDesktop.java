package com.keke.kynex.core;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonPrimitive;
import com.google.gson.Strictness;
import com.keke.kynex.account.AccountStore;
import com.keke.kynex.account.CredentialVault;
import java.io.IOException;
import java.io.InputStreamReader;
import java.awt.Desktop;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import org.eclipse.swt.SWT;
import org.eclipse.swt.browser.Browser;
import org.eclipse.swt.browser.BrowserFunction;
import org.eclipse.swt.browser.LocationAdapter;
import org.eclipse.swt.browser.LocationEvent;
import org.eclipse.swt.layout.FillLayout;
import org.eclipse.swt.widgets.Display;
import org.eclipse.swt.widgets.Shell;

import static com.keke.kynex.core.JsonFiles.required;
import static com.keke.kynex.core.JsonFiles.text;
import static com.keke.kynex.core.LaunchManifest.object;

/** Runs the launcher interface and migrated commands without the old desktop host. */
public final class JavaDesktop {
    private static final Gson IPC = new GsonBuilder().setStrictness(Strictness.STRICT).serializeNulls().create();
    private final Path dataRoot;
    private final GameDirectories directories;
    private final AccountStore accounts;
    private final MicrosoftLogin microsoft;
    private final ExternalLogin external;
    private final SkinAppearance skins;
    private final DesktopUpdates updates;
    private final HotfixBundles hotfix;
    private final AssistantProviders modelProviders;
    private final AssistantService assistant;
    private final WorkshopTasks workshop;
    private final VoiceTranscription voice;
    private final GameDownloads downloads = new GameDownloads();
    private final MinecraftCatalog catalog = new MinecraftCatalog(downloads);
    private final LoaderCatalog loaders = new LoaderCatalog(downloads);
    private final OptiFineInstall optiFine = new OptiFineInstall(downloads);
    private final CatalogNetwork catalogNetwork = new CatalogNetwork();
    private final ResourceCatalog resources = new ResourceCatalog(catalogNetwork);
    private final ResourceVersions resourceVersions = new ResourceVersions(catalogNetwork, resources);
    private final InstalledArtwork installedArtwork = new InstalledArtwork(catalogNetwork, resources);
    private final ResourceFileDownload resourceFiles = new ResourceFileDownload(downloads, catalogNetwork, resources, resourceVersions);
    private final WorldInstaller worlds = new WorldInstaller(resourceFiles, resourceVersions);
    private final ProjectInstaller projects = new ProjectInstaller(downloads, catalogNetwork, resources);
    private final ModUpdates modUpdates = new ModUpdates(catalogNetwork, resources, projects);
    private final WorkshopInsights insights;
    private final PackArtwork packArtwork;
    private final LocalResources localResources = new LocalResources();
    private final MinecraftInstaller installer = new MinecraftInstaller(downloads);
    private final PackInstaller packs = new PackInstaller(downloads, catalogNetwork, resources, installer);
    private final PackExport exports = new PackExport(catalogNetwork);
    private final SchematicCatalog schematics = new SchematicCatalog(downloads, resources, resourceVersions);
    private final SchematicAppearance schematicAppearance = new SchematicAppearance(downloads);
    private final GameRuntimeInstaller runtimes = new GameRuntimeInstaller(downloads);
    private final Map<String, DesktopInstallTask> tasks = new ConcurrentHashMap<>();
    private final Map<String, Long> modScans = new ConcurrentHashMap<>();
    private final java.util.concurrent.atomic.AtomicLong scanSequence = new java.util.concurrent.atomic.AtomicLong();
    private volatile boolean mirror;

    JavaDesktop(Path dataRoot) throws IOException {
        this.dataRoot = Files.createDirectories(dataRoot).toRealPath();
        directories = new GameDirectories(this.dataRoot);
        accounts = new AccountStore(this.dataRoot);
        var vault = new CredentialVault(new WindowsCredentials("Kynex Launcher Source"));
        microsoft = new MicrosoftLogin(accounts, vault);
        external = new ExternalLogin(accounts, vault);
        skins = new SkinAppearance(this.dataRoot, accounts, microsoft, external);
        updates = new DesktopUpdates(this.dataRoot);
        hotfix = new HotfixBundles(this.dataRoot, updates);
        modelProviders = new AssistantProviders(this.dataRoot, vault);
        assistant = new AssistantService(modelProviders);
        insights = new WorkshopInsights(this.dataRoot, modUpdates);
        packArtwork = new PackArtwork(this.dataRoot, catalogNetwork, resources);
        workshop = new WorkshopTasks(this.dataRoot, directories, downloads, installer, catalog, loaders, resources, resourceVersions,
            projects, exports, assistant, catalogNetwork, insights, packs);
        voice = new VoiceTranscription(this.dataRoot, vault);
        try {
            mirror = "bmclapi".equals(text(object(JsonFiles.read(this.dataRoot.resolve("download-settings.json"))), "source", ""));
        } catch (IOException | JsonParseException ignored) {
            // Use the official source until a preference is available.
        }
    }

    public static void main(String[] args) throws Exception {
        if (System.getProperty("http.maxConnections") == null) System.setProperty("http.maxConnections", "64");
        if (args.length == 0 || args.length == 2 && "--verify".equals(args[0])) {
            Path application = Path.of(JavaDesktop.class.getProtectionDomain().getCodeSource().getLocation().toURI()).getParent();
            boolean verification = args.length == 2;
            Path root = verification ? Path.of(args[1]) : installedDataRoot();
            try {
                new JavaDesktop(root).open(application.resolve("dist"), verification, null);
                if (verification) Files.writeString(root.resolve("verified.txt"), "Kynex Launcher Java Desktop\n");
            } catch (Exception error) {
                Path report = Files.createDirectories(root).resolve("launcher-startup-error.log");
                try (var output = new java.io.PrintWriter(Files.newBufferedWriter(report))) { error.printStackTrace(output); }
                if (!verification) javax.swing.JOptionPane.showMessageDialog(null, "启动器无法打开。错误记录：\n" + report,
                    "Kynex Launcher", javax.swing.JOptionPane.ERROR_MESSAGE);
                throw error;
            }
            return;
        }
        if (args.length != 2 && (args.length != 3 || !"--verify".equals(args[2]))) {
            throw new IllegalArgumentException("用法：JavaDesktop <界面目录> <数据目录> [--verify]");
        }
        new JavaDesktop(Path.of(args[1])).open(Path.of(args[0]), args.length == 3, null);
    }

    private static Path installedDataRoot() throws IOException {
        String appdata = System.getenv("APPDATA");
        if (appdata == null || appdata.isBlank()) throw new IOException("无法找到 Windows 用户设置目录");
        try (var config = JavaDesktop.class.getResourceAsStream("/build-channel.json")) {
            if (config == null) throw new IOException("缺少启动器版本配置");
            var build = IPC.fromJson(new InputStreamReader(config, java.nio.charset.StandardCharsets.UTF_8), JsonObject.class);
            String identifier = required(build, "identifier");
            if (!identifier.matches("[A-Za-z0-9][A-Za-z0-9.-]{0,100}") || identifier.endsWith(".")) throw new IOException("启动器标识无效");
            return Path.of(appdata, identifier, "game");
        }
    }

    private void open(Path frontendRoot, boolean verify, Path legacy) throws IOException {
        Display.setAppName("Kynex Launcher");
        WindowsShell.identify();
        System.setProperty("org.eclipse.swt.browser.EdgeDataDir", dataRoot.resolve("webview").toString());
        DesktopWindowSurface.prepareBrowser();
        var display = new Display();
        try (var frontend = new DesktopFrontend(frontendRoot, hotfix); var requests = Executors.newSingleThreadExecutor();
             var catalogRequests = Executors.newFixedThreadPool(4);
             var searchRequests = Executors.newFixedThreadPool(6);
             var packInspections = Executors.newFixedThreadPool(2);
             var iconRequests = Executors.newFixedThreadPool(8); var serviceRequests = Executors.newVirtualThreadPerTaskExecutor();
             var backgroundScans = Executors.newFixedThreadPool(2);
             var installs = Executors.newSingleThreadExecutor()) {
            var storage = new DesktopStorage(dataRoot, legacy);
            var shell = new Shell(display, SWT.NO_TRIM);
            DesktopWindowSurface.prepare(shell);
            shell.setLayout(new FillLayout());
            shell.setText("Kynex Launcher");
            WindowsShell.applyIcon(shell);
            shell.setSize(1080, 720);
            if (verify) shell.setLocation(-20000, -20000);
            else {
                var area = display.getPrimaryMonitor().getClientArea();
                shell.setLocation(area.x + Math.max(0, (area.width - 1080) / 2), area.y + Math.max(0, (area.height - 720) / 2));
            }
            var browser = new Browser(shell, SWT.EDGE);
            browser.setBackground(display.getSystemColor(SWT.COLOR_BLACK));
            DesktopFileDrop.attach(browser, (event, details) -> {
                if (!browser.isDisposed() && frontend.owns(browser.getUrl())) {
                    browser.execute("window.kynexDesktopEvent(" + IPC.toJson(event) + "," + IPC.toJson(details) + ")");
                }
            });
            browser.addOpenWindowListener(event -> event.required = true);
            browser.addLocationListener(new LocationAdapter() {
                @Override public void changing(LocationEvent event) {
                    event.doit = frontend.owns(event.location);
                }
            });
            new BrowserFunction(browser, "kynexDesktopAsset", true, new String[0]) {
                @Override public Object function(Object[] args) {
                    if (!frontend.owns(browser.getUrl()) || args.length != 1 || !(args[0] instanceof String path)
                        || path.length() > 32_000) return "";
                    try { return frontend.asset(path); }
                    catch (IOException | IllegalArgumentException refused) { return ""; }
                }
            };
            new BrowserFunction(browser, "kynexDesktopMove", true, new String[0]) {
                @Override public Object function(Object[] args) {
                    if (frontend.owns(browser.getUrl()) && args.length == 2 && args[0] instanceof Double x && args[1] instanceof Double y
                        && Double.isFinite(x) && Double.isFinite(y) && Math.abs(x) <= 2000 && Math.abs(y) <= 2000) {
                        var point = shell.getLocation();
                        shell.setLocation(point.x + x.intValue(), point.y + y.intValue());
                    }
                    return null;
                }
            };
            new BrowserFunction(browser, "kynexDesktopStorage", true, new String[0]) {
                @Override public Object function(Object[] args) {
                    if (!frontend.owns(browser.getUrl()) || args.length < 1 || !(args[0] instanceof String command)) {
                        return "界面设置请求无效";
                    }
                    if (command.equals("read")) return storage.read();
                    if (args.length != 3 || !(args[1] instanceof String key) || !(args[2] instanceof String value)
                        || key.length() > 4096 || value.length() > 16 * 1024 * 1024) return "界面设置请求无效";
                    try { storage.change(command, key, value); }
                    catch (IOException error) { return errorMessage(error); }
                    return null;
                }
            };
            new BrowserFunction(browser, "kynexDesktopRequest", true, new String[0]) {
                @Override public Object function(Object[] args) {
                    if (!frontend.owns(browser.getUrl()) || args.length != 1 || !(args[0] instanceof String raw)
                        || raw.length() > 162 * 1024 * 1024) return "桌面调用请求无效";
                    JsonObject request;
                    try {
                        request = IPC.fromJson(raw, JsonObject.class);
                        if (request == null || !request.has("id")) return "桌面调用请求无效";
                    } catch (JsonParseException invalid) {
                        return "桌面调用请求无效";
                    }
                    String command = text(request, "command", "");
                    JsonObject payload = object(request.get("payload"));
                    String action = text(payload, "action", "");
                    if (raw.length() > 8 * 1024 * 1024 && !java.util.Set.of("import_resource", "ai_assistant", "ai_assistant_stream",
                        "ai_diagnose", "voice_transcribe").contains(action)) {
                        return "桌面调用请求超过大小限制";
                    }
                    if (command.startsWith("plugin:window|") || command.startsWith("plugin:dialog|")) {
                        display.asyncExec(() -> reply(browser, frontend, request, () -> window(shell, command, payload)));
                    } else if ("dispatch".equals(command) && "prepare_pack_upload".equals(action)) {
                        packInspections.execute(() -> {
                            var details = object(payload.get("payload"));
                            String result = response(request, () -> frontend.preparePackUpload(dataRoot,
                                required(details, "name"), ResourceCatalog.number(details, "size", 0)));
                            if (!display.isDisposed()) display.asyncExec(() -> send(browser, frontend, result));
                        });
                    } else if ("dispatch".equals(command) && "scan_installed_mod_updates".equals(action)) {
                        requests.execute(() -> {
                            JsonObject details = object(payload.get("payload"));
                            String result = response(request, () -> {
                                Path root = selectedRoot(details);
                                int scheduled = 0;
                                for (var row : instances(root)) {
                                    JsonObject instance = object(row);
                                    String id = text(instance, "id", "");
                                    if (id.isEmpty()) continue;
                                    var scan = details.deepCopy();
                                    scan.addProperty("id", id);
                                    if (!modUpdates.hasFiles(modUpdates.folder(root, dataRoot, scan))) continue;
                                    if (scheduleModScan(root, scan, backgroundScans, browser, frontend, display)) scheduled++;
                                }
                                return DesktopUpdates.fields("scheduled", scheduled);
                            });
                            if (!display.isDisposed()) display.asyncExec(() -> send(browser, frontend, result));
                        });
                    } else if ("dispatch".equals(command) && "detect_games".equals(action)) {
                        display.asyncExec(() -> reply(browser, frontend, request, WindowsGames::scan));
                    } else if ("dispatch".equals(command) && "ai_assistant_stream".equals(action)) {
                        serviceRequests.execute(() -> {
                            String result = response(request, () -> assistant.stream(object(payload.get("payload")), event -> display.asyncExec(() -> {
                                if (!browser.isDisposed() && frontend.owns(browser.getUrl()))
                                    browser.execute("window.kynexDesktopEvent('kynex-ai-stream'," + IPC.toJson(event) + ")");
                            })));
                            if (!display.isDisposed()) display.asyncExec(() -> send(browser, frontend, result));
                        });
                    } else if ("dispatch".equals(command) && "install_update".equals(action)) {
                        serviceRequests.execute(() -> {
                            var close = new java.util.concurrent.atomic.AtomicBoolean();
                            String result = response(request, () -> {
                                JsonElement installed = updates.install(() -> !tasks.isEmpty(), event -> display.asyncExec(() -> {
                                    if (!browser.isDisposed() && frontend.owns(browser.getUrl()))
                                        browser.execute("window.kynexDesktopEvent('kynex-update-progress'," + IPC.toJson(event) + ")");
                                }));
                                close.set(true);
                                return installed;
                            });
                            if (!display.isDisposed()) display.asyncExec(() -> {
                                send(browser, frontend, result);
                                if (close.get() && !shell.isDisposed()) shell.close();
                            });
                        });
                    } else if ("dispatch".equals(command) &&
                        ("install".equals(action) || "install_java".equals(action) || "launch".equals(action)
                            || "download_resource_file".equals(action) || "install_map".equals(action) || "install_project".equals(action)
                            || "import_pack".equals(action) || "export_pack".equals(action) || "update_mods".equals(action)
                            || "schematic_catalog_download".equals(action))) {
                        JsonObject install = object(payload.get("payload"));
                        java.util.function.Consumer<JsonObject> publish = event -> {
                            if (display.isDisposed()) return;
                            display.asyncExec(() -> {
                                if (!browser.isDisposed() && frontend.owns(browser.getUrl()))
                                    browser.execute("window.kynexDesktopEvent('kynex-progress'," + IPC.toJson(event) + ")");
                            });
                        };
                        var task = new DesktopInstallTask(action, install, event -> display.asyncExec(() -> {
                            if (!browser.isDisposed() && frontend.owns(browser.getUrl())) {
                                browser.execute("window.kynexDesktopEvent('kynex-progress'," + IPC.toJson(event) + ")");
                            }
                        }));
                        tasks.put(task.id(), task);
                        task.update("排队等待", 0, 1);
                        installs.execute(() -> {
                            String result = response(request, () -> {
                                try {
                                    GameDownloads.check(task::stopped);
                                    Path root = directories.resolveSelected(text(install, "directoryId", null));
                                    JsonObject value = switch (action) {
                                        case "install_java" -> runtimes.install(root.toRealPath(), install.get("major").getAsInt(), task);
                                        case "launch" -> launchWithModUpdates(root.toRealPath(), install, task, publish);
                                        case "download_resource_file" -> resourceFiles.save(root.toRealPath(), install, task);
                                        case "install_map" -> worlds.install(root.toRealPath(), dataRoot, install, task);
                                        case "install_project" -> text(install, "kind", "").equals("modpacks")
                                            ? packs.remote(root.toRealPath(), install, mirror, task)
                                            : projects.install(root.toRealPath(), dataRoot, install, task);
                                        case "import_pack" -> packs.local(root.toRealPath(), Path.of(required(install, "path")), install, mirror, task);
                                        case "export_pack" -> exports.export(root.toRealPath(), dataRoot, install, task);
                                        case "update_mods" -> modUpdates.apply(root.toRealPath(), dataRoot, install, task);
                                        case "schematic_catalog_download" -> schematics.download(root.toRealPath(), dataRoot, install, task);
                                        default -> installer.install(root.toRealPath(), install, mirror, task);
                                    };
                                    task.finish(text(value, "name", text(value, "filename", text(value, "path", ""))), null);
                                    if ("update_mods".equals(action) || "import_pack".equals(action) || "install_project".equals(action)) {
                                        JsonObject scan = install.deepCopy();
                                        if (text(scan, "id", "").isEmpty() && value.has("id")) scan.add("id", value.get("id"));
                                        scan.addProperty("force", true);
                                        if (!text(scan, "id", "").isEmpty()) scheduleModScan(root.toRealPath(), scan, backgroundScans, browser, frontend, display);
                                    }
                                    return value;
                                } catch (Exception error) {
                                    task.finish("", errorMessage(error));
                                    throw error;
                                } finally {
                                    tasks.remove(task.id());
                                }
                            });
                            display.asyncExec(() -> send(browser, frontend, result));
                        });
                    } else if ("dispatch".equals(command) && action.startsWith("agent_")) {
                        JsonObject operation = object(payload.get("payload"));
                        var queue = action.equals("agent_tool") && LaunchManifest.is(operation.get("confirmed"), true) ? installs :
                            java.util.Set.of("agent_tool", "agent_import_plan").contains(action) ? catalogRequests : requests;
                        queue.execute(() -> {
                            JsonObject details = operation.deepCopy();
                            String result = response(request, () -> workshop.dispatch(action, details, serviceRequests, installs, event -> {
                                if (!display.isDisposed()) display.asyncExec(() -> {
                                    if (!browser.isDisposed() && frontend.owns(browser.getUrl()))
                                        browser.execute("window.kynexDesktopEvent('kynex-agent'," + IPC.toJson(event) + ")");
                                });
                            }, JavaDesktop.this::verifyWorkshop, mirror));
                            if (!display.isDisposed()) display.asyncExec(() -> send(browser, frontend, result));
                        });
                    } else {
                        var queue = !"dispatch".equals(command) ? requests : switch (action) {
                            case "search", "map_search" -> searchRequests;
                            case "inspect_pack" -> packInspections;
                            case "manifest", "loaders", "optifine_versions", "project_versions", "news", "mirror_benchmark",
                                "microsoft_start", "microsoft_poll", "auth_server", "external_login", "sync_appearance", "skin_import",
                                "resource_requirements", "pixelmap_schematics", "schematic_preview", "schematic_catalog_preview",
                                "schematic_appearance", "java", "check_update", "hotfix_check", "hotfix_install", "check_mod_updates" ->
                                catalogRequests;
                            case "icon", "wallpaper_engine_scan", "warm_loader_catalogs", "skin_texture", "resource_artwork", "map_world_covers",
                                "hydrate_pack_icons" -> iconRequests;
                            case "delete_resources", "import_resource", "import_resource_paths", "toggle_resource", "resource_move",
                                "delete_instance", "ensure_loader_components" -> installs;
                            case "ai_assistant", "ai_diagnose", "ai_test_connection", "ai_cancel", "voice_transcribe" -> serviceRequests;
                            default -> requests;
                        };
                        queue.execute(() -> {
                            String result = response(request, () -> invoke(command, payload));
                            if (!display.isDisposed()) display.asyncExec(() -> send(browser, frontend, result));
                        });
                    }
                    return null;
                }
            };
            shell.open();
            browser.setUrl(frontend.url() + (verify ? "?nosplash=1#home" : ""));
            boolean[] passed = {false};
            if (verify) verifyBrowser(browser, shell, passed);
            try {
                while (!shell.isDisposed()) {
                    if (!display.readAndDispatch()) display.sleep();
                }
            } finally {
                tasks.values().forEach(DesktopInstallTask::cancel);
                backgroundScans.shutdownNow();
                serviceRequests.shutdownNow();
            }
            if (verify && !passed[0]) throw new IOException("Java 桌面窗口验证未完成");
        } finally {
            display.dispose();
        }
    }

    private static void verifyBrowser(Browser browser, Shell shell, boolean[] passed) {
        var display = shell.getDisplay();
        display.timerExec(200, new Runnable() {
            @Override public void run() {
                if (shell.isDisposed()) return;
                Object status = browser.evaluate("""
                    if (!document.querySelector('.app.page-home .home-launch-button')) return 'loading';
                    if (!window.kynexVerification) {
                      window.kynexVerification = 'working';
                      const invoke = window.__TAURI_INTERNALS__.invoke;
                      invoke('dispatch', {action:'offline_login', payload:{name:'KXL_Test'}})
                        .then(account => Promise.all([
                          invoke('dispatch', {action:'list_accounts'}),
                          invoke('dispatch', {action:'agent_tool', payload:{tool:'template_list', directoryId:'default'}}),
                          invoke('dispatch', {action:'agent_list'})
                        ]).then(([accounts, templates, tasks]) => {
                          if (!accounts.some(item => item.id === account.id)) throw new Error('missing account');
                          if (templates.length !== 8 || !Array.isArray(tasks)) throw new Error('workshop offline check failed');
                          window.kynexVerification = 'passed';
                        })).catch(error => { window.kynexVerification = String(error); });
                    }
                    return window.kynexVerification;
                    """);
                if ("passed".equals(status)) {
                    passed[0] = true;
                    shell.dispose();
                } else if ("working".equals(status) || "loading".equals(status)) {
                    display.timerExec(150, this);
                } else {
                    throw new IllegalStateException("Java 桌面通信测试失败：" + status);
                }
            }
        });
        display.timerExec(20000, () -> { if (!shell.isDisposed()) shell.dispose(); });
    }

    @FunctionalInterface
    private interface Command { JsonElement run() throws Exception; }

    private static String response(JsonObject request, Command command) {
        var output = new JsonObject();
        output.add("id", request.get("id"));
        try {
            output.add("value", command.run());
        } catch (Exception error) {
            output.addProperty("error", errorMessage(error));
        }
        return IPC.toJson(output);
    }

    private static String errorMessage(Exception error) {
        return error.getMessage() == null ? "桌面操作失败" : error.getMessage();
    }

    private static void reply(Browser browser, DesktopFrontend frontend, JsonObject request, Command command) {
        send(browser, frontend, response(request, command));
    }

    private static void send(Browser browser, DesktopFrontend frontend, String reply) {
        if (!browser.isDisposed() && frontend.owns(browser.getUrl())) {
            browser.execute("window.kynexDesktopReply(" + reply + ")");
        }
    }

    private static JsonElement window(Shell shell, String command, JsonObject payload) {
        switch (command) {
            case "plugin:window|minimize" -> shell.setMinimized(true);
            case "plugin:window|set_focus" -> shell.forceActive();
            case "plugin:window|close" -> shell.close();
            case "plugin:window|set_cursor_icon", "plugin:window|set_cursor_visible" -> shell.setCursor(null);
            case "plugin:dialog|open", "plugin:dialog|save" -> {
                return DesktopDialogs.choose(shell, command, object(payload.get("options")));
            }
            default -> throw new IllegalArgumentException("此窗口操作尚未接入 Java");
        }
        return JsonNull.INSTANCE;
    }

    private JsonElement invoke(String command, JsonObject args) throws Exception {
        if (!"dispatch".equals(command)) throw new IllegalArgumentException("此桌面命令尚未接入 Java");
        String action = required(args, "action");
        JsonObject payload = object(args.get("payload"));
        return switch (action) {
            case "show_main_window" -> new JsonPrimitive(true);
            case "check_update" -> updates.check();
            case "hotfix_status" -> hotfix.status();
            case "hotfix_check" -> hotfix.check();
            case "hotfix_ready" -> hotfix.ready();
            case "hotfix_install" -> hotfix.install();
            case "hotfix_rollback" -> hotfix.rollback();
            case "ai_options" -> modelProviders.options(payload);
            case "ai_models" -> modelProviders.models(payload);
            case "ai_key_status", "ai_key_save", "ai_key_remove" -> modelProviders.legacyKey(action, payload);
            case "ai_voice_config" -> voice.config(payload);
            case "voice_transcribe" -> voice.transcribe(payload);
            case "ai_assistant" -> assistant.structured(payload);
            case "ai_diagnose" -> assistant.diagnose(payload);
            case "ai_test_connection" -> assistant.test(payload);
            case "ai_cancel" -> assistant.cancel(payload);
            case "assistant_context" -> InstanceContext.read(LocalGameFiles.running(selectedRoot(payload), dataRoot, payload));
            case "assistant_export_markdown" -> AssistantService.export(payload);
            case "launch_game" -> {
                WindowsGames.launch(required(payload, "game"), required(payload, "appId"));
                yield new JsonPrimitive(true);
            }
            case "open_game" -> {
                WindowsGames.store(required(payload, "game"));
                yield new JsonPrimitive(true);
            }
            case "download_status" -> WorkshopPlans.json("source", mirror ? "bmclapi" : "official");
            case "environment" -> {
                Path root = selectedRoot(payload);
                yield WorkshopPlans.json("os", "windows", "arch", System.getProperty("os.arch").equals("amd64") ? "x86_64" : System.getProperty("os.arch"),
                    "root", root.toString(), "java", JavaRuntimes.scan(root, dataRoot));
            }
            case "download_config" -> {
                String source = required(payload, "source");
                if (!source.equals("official") && !source.equals("bmclapi")) throw new IOException("下载源无效");
                var settings = new JsonObject();
                settings.addProperty("source", source);
                JsonFiles.write(GameFiles.target(dataRoot, "download-settings.json"), settings);
                mirror = source.equals("bmclapi");
                yield settings;
            }
            case "manifest" -> catalog.versions(directories.resolveSelected(text(payload, "directoryId", null)).toRealPath(),
                mirror, LaunchManifest.is(payload.get("force"), true), () -> false);
            case "loaders" -> loaders.versions(directories.resolveSelected(text(payload, "directoryId", null)).toRealPath(),
                required(payload, "game"), required(payload, "loader"), mirror, LaunchManifest.is(payload.get("force"), true));
            case "warm_loader_catalogs" -> loaders.warm(selectedRoot(payload), mirror);
            case "optifine_versions" -> optiFine.versions(directories.resolveSelected(text(payload, "directoryId", null)).toRealPath(),
                required(payload, "game"), LaunchManifest.is(payload.get("force"), false));
            case "search" -> resources.search(directories.resolveSelected(text(payload, "directoryId", null)).toRealPath(), payload);
            case "map_search" -> resources.mapSearch(selectedRoot(payload), payload);
            case "mirror_benchmark" -> downloads.benchmark();
            case "project_versions" -> resourceVersions.list(directories.resolveSelected(text(payload, "directoryId", null)).toRealPath(), payload);
            case "resource_requirements" -> projects.requirements(selectedRoot(payload), dataRoot, payload);
            case "project_dependencies" -> projects.curseDependencies(selectedRoot(payload), dataRoot, payload);
            case "resources" -> localResources.list(selectedRoot(payload), dataRoot, payload);
            case "resource_artwork" -> installedArtwork.lookup(selectedRoot(payload), dataRoot, payload);
            case "map_world_covers" -> WorldCovers.lookup(selectedRoot(payload), dataRoot, payload, resources, resourceVersions);
            case "resource_move" -> localResources.movePack(selectedRoot(payload), dataRoot, payload);
            case "inspect_pack" -> packs.inspect(Path.of(required(payload, "path")));
            case "export_options" -> exports.options(selectedRoot(payload), dataRoot, payload);
            case "pixelmap_schematics" -> schematics.search(selectedRoot(payload), payload);
            case "schematic_preview" -> SchematicPreview.resource(selectedRoot(payload), dataRoot, payload);
            case "schematic_catalog_preview" -> schematics.preview(selectedRoot(payload), payload);
            case "schematic_appearance" -> schematicAppearance.load(selectedRoot(payload), dataRoot, payload);
            case "import_resource", "import_resource_paths" -> localResources.importResources(selectedRoot(payload), dataRoot, payload,
                action.equals("import_resource_paths"));
            case "delete_resources" -> localResources.remove(selectedRoot(payload), dataRoot, payload, JavaDesktop::recycle);
            case "ensure_loader_components" -> ensureComponents(selectedRoot(payload), payload);
            case "toggle_resource" -> {
                localResources.toggle(selectedRoot(payload), dataRoot, payload);
                yield new JsonPrimitive(true);
            }
            case "icon" -> new ArtworkCache(directories.resolveSelected(text(payload, "directoryId", null))).fetch(payload, catalogNetwork);
            case "save_instance" -> LocalGameFiles.saveSettings(selectedRoot(payload), payload);
            case "save_instance_icon" -> LocalGameFiles.saveIcon(selectedRoot(payload), payload);
            case "mod_update_mode" -> LocalGameFiles.updateMode(selectedRoot(payload), payload);
            case "check_mod_updates" -> modUpdates.check(selectedRoot(payload), dataRoot, payload);
            case "datapack_worlds" -> LocalGameFiles.worlds(selectedRoot(payload), dataRoot, payload);
            case "read_image", "assistant_read_screenshot" -> LocalGameFiles.readImage(payload, "assistant_read_screenshot".equals(action));
            case "read_audio" -> LocalGameFiles.readAudio(payload);
            case "read_log" -> new JsonPrimitive(LocalGameFiles.readLog(payload));
            case "news" -> NewsArticles.list(dataRoot, downloads, LaunchManifest.is(payload.get("force"), true));
            case "wallpaper_engine_scan" -> WallpaperLibrary.scanDefault();
            case "skin_export" -> new JsonPrimitive(TextureFiles.exportSkin(required(payload, "texture"), Path.of(required(payload, "path"))));
            case "skin_texture" -> new JsonPrimitive(skins.texture(payload));
            case "skin_import" -> skins.importSkin(payload);
            case "apply_skin", "apply_cape" -> skins.apply(payload, "apply_cape".equals(action));
            case "open_url" -> {
                String url = ResourceCatalog.https(required(payload, "url"));
                if (url == null) throw new IOException("只能打开 HTTPS 网址");
                Desktop.getDesktop().browse(URI.create(url));
                yield new JsonPrimitive(true);
            }
            case "open_data_folder", "open_folder", "open_resource_folder" -> {
                Path folder = switch (action) {
                    case "open_data_folder" -> dataRoot;
                    case "open_folder" -> LocalGameFiles.running(selectedRoot(payload), dataRoot, payload);
                    default -> LocalGameFiles.resourceDirectory(selectedRoot(payload), dataRoot, payload);
                };
                if ("schematics".equals(text(payload, "kind", "")) && payload.has("directory")
                    && !folder.equals(Path.of(required(payload, "directory")))) {
                    throw new IOException("投影目录已更改，请在版本设置中查看当前投影文件夹");
                }
                Desktop.getDesktop().open(Files.createDirectories(folder).toFile());
                yield new JsonPrimitive(true);
            }
            case "cancel" -> {
                String id = text(payload, "taskId", "");
                boolean cancelled;
                if (id.isEmpty()) {
                    cancelled = false;
                    for (DesktopInstallTask task : tasks.values()) cancelled |= task.cancel();
                } else {
                    DesktopInstallTask task = tasks.get(id);
                    cancelled = task != null && task.cancel();
                }
                yield new JsonPrimitive(cancelled);
            }
            case "game_directories" -> directories.list();
            case "add_game_directory", "select_game_directory", "remove_game_directory" -> directories.change(action, payload);
            case "list_accounts" -> accounts.list();
            case "offline_login" -> accounts.loginOffline(required(payload, "name"));
            case "microsoft_status" -> microsoft.status();
            case "microsoft_start" -> microsoft.start();
            case "microsoft_poll" -> microsoft.poll(required(payload, "flowId"));
            case "auth_server" -> external.server(payload);
            case "external_login" -> external.login(payload);
            case "sync_appearance" -> {
                JsonObject account = accounts.find(required(payload, "accountId"));
                yield switch (text(account, "kind", "")) {
                    case "microsoft" -> microsoft.sync(account);
                    case "external" -> external.sync(account);
                    default -> account;
                };
            }
            case "microsoft_cancel" -> {
                microsoft.cancel(required(payload, "flowId"));
                yield new JsonPrimitive(true);
            }
            case "delete_account" -> {
                microsoft.remove(required(payload, "id"));
                yield new JsonPrimitive(true);
            }
            case "list_instances" -> instances(selectedRoot(payload));
            case "hydrate_pack_icons" -> {
                Path root = selectedRoot(payload);
                yield packArtwork.hydrate(root, instances(root));
            }
            case "delete_instance" -> deleteInstance(selectedRoot(payload), payload);
            case "java" -> JavaRuntimes.scan(selectedRoot(payload), dataRoot);
            default -> throw new IllegalArgumentException("此功能尚未接入 Java");
        };
    }

    private Path selectedRoot(JsonObject payload) throws IOException {
        return directories.resolveSelected(text(payload, "directoryId", null)).toRealPath();
    }

    private JsonArray instances(Path root) throws IOException {
        ExternalInstances.discover(root, dataRoot);
        var hidden = ExternalInstances.hidden(root);
        var result = new JsonArray();
        Path directory = root.resolve("instances");
        if (!Files.isDirectory(directory)) return result;
        try (var paths = Files.list(directory)) {
            for (Path path : paths.sorted().toList()) {
                Path file = path.resolve("kxl.json");
                if (!Files.isRegularFile(file) || !file.toRealPath().startsWith(directory.toRealPath())) continue;
                try {
                    JsonElement value = JsonFiles.read(file);
                    if (value instanceof JsonObject instance) {
                        if (!text(instance, "temporaryPackUpdate", "").isEmpty()) continue;
                        if (hidden.contains(new JsonPrimitive(text(instance, "externalVersion", "")))) continue;
                        String external = text(instance, "externalSource", null);
                        if (external == null || Files.isDirectory(Path.of(external))) result.add(instance);
                    }
                } catch (IOException | JsonParseException ignored) {
                    // Invalid instance files do not prevent the rest of the library from opening.
                }
            }
        }
        return result;
    }

    private static boolean recycle(Path file) {
        return WindowsShell.recycle(file);
    }

    private JsonObject deleteInstance(Path root, JsonObject payload) throws IOException {
        Path instance = LocalGameFiles.instance(root, payload);
        JsonObject info = LocalGameFiles.configuration(instance);
        if (!text(info, "externalVersion", "").isEmpty()) ExternalInstances.hide(root, info);
        else if (!recycle(instance)) throw new IOException("无法将该实例移到回收站，请退出游戏并关闭占用该目录的程序后重试。");
        var result = new JsonObject();
        result.addProperty("name", text(info, "name", required(payload, "id")));
        return result;
    }

    private JsonObject ensureComponents(Path root, JsonObject payload) throws IOException, InterruptedException {
        var result = new JsonObject();
        result.addProperty("installed", false);
        String loader = text(LocalGameFiles.configuration(LocalGameFiles.instance(root, payload)), "loader", "vanilla");
        if (!java.util.Set.of("fabric", "quilt").contains(loader)) {
            result.addProperty("required", false);
            return result;
        }
        boolean fabric = "fabric".equals(loader);
        String project = fabric ? "fabric-api" : "qsl";
        result.addProperty("required", true);
        result.addProperty("label", fabric ? "Fabric API" : "Quilt Standard Libraries");
        var request = payload.deepCopy();
        request.addProperty("kind", "mods");
        var accepted = fabric ? java.util.Set.of("fabric-api") : java.util.Set.of("qsl", "quilted_fabric_api");
        boolean present = localResources.list(root, dataRoot, request).asList().stream().map(LaunchManifest::object)
            .filter(mod -> LaunchManifest.is(mod.get("enabled"), true)).flatMap(mod -> LaunchManifest.array(mod.get("modIds")).asList().stream())
            .anyMatch(item -> item.isJsonPrimitive() && accepted.contains(item.getAsString()));
        if (!present) {
            request.addProperty("project", project);
            projects.install(root, dataRoot, request, new MinecraftInstaller.Progress() {});
            result.addProperty("installed", true);
        }
        result.addProperty("present", true);
        return result;
    }

    private JsonObject launchWithModUpdates(Path root, JsonObject request, DesktopInstallTask task,
                                            java.util.function.Consumer<JsonObject> event) throws Exception {
        JsonObject info = LocalGameFiles.configuration(LocalGameFiles.instance(root, request));
        if ("auto".equals(text(info, "modUpdateMode", "manual")) && modUpdates.hasFiles(modUpdates.folder(root, dataRoot, request))) {
            JsonObject scan = request.deepCopy();
            if (!scan.has("curseforgeKey")) scan.addProperty("curseforgeKey", text(object(scan.get("settings")), "curseforgeKey", ""));
            modUpdates.apply(root, dataRoot, scan, new MinecraftInstaller.Progress() {
                @Override public boolean stopped() { return task.stopped(); }
                @Override public void update(String stage, int done, int total) { task.update(stage, done, total); }
            });
        }
        String id = required(request, "id");
        java.time.Instant started = java.time.Instant.now();
        return new InstalledGameLauncher(dataRoot).launch(request, runtimes, microsoft, external, task, (process, log, game, title) -> {
            GameWindowTitle.watch(process, title);
            process.onExit().thenAccept(exited -> Thread.startVirtualThread(() -> gameExited(root, id, log, game, started, exited.exitValue(), event)));
        });
    }

    private void gameExited(Path root, String instance, Path log, Path game, java.time.Instant started, int status,
                            java.util.function.Consumer<JsonObject> event) {
        var details = new StringBuilder();
        for (Path file : java.util.List.of(log, game.resolve("logs/latest.log"))) {
            try {
                if (Files.isRegularFile(file) && file.equals(file.toRealPath()) && !Files.getLastModifiedTime(file).toInstant().isBefore(started))
                    details.append(WorkshopVerification.tail(file, 128 * 1024)).append('\n');
            } catch (IOException unavailable) { /* An unavailable log does not change the exit code. */ }
        }
        String content = details.toString();
        boolean entered = java.util.List.of("OpenAL initialized", "Created: ", "Sound engine started").stream().anyMatch(content::contains);
        boolean abnormal = status != 0 || !entered && (java.time.Duration.between(started, java.time.Instant.now()).toSeconds() < 60
            || content.contains("Exception in thread \"main\""));
        try { insights.record(root, instance, content, abnormal); }
        catch (IOException unavailable) { /* Automatic analysis can still use the captured log. */ }
        if (!abnormal) return;
        try {
            if (LaunchManifest.is(modelProviders.options(new JsonObject()).get("automatic"), false)) return;
            event.accept(WorkshopPlans.json("autoDiagnosis", true, "status", "analyzing", "reason", "游戏退出（代码 " + status + "）"));
            var reply = assistant.diagnose(WorkshopPlans.json("text", content));
            event.accept(WorkshopPlans.json("autoDiagnosis", true, "status", "done", "report", reply.get("report")));
        } catch (Exception failure) {
            event.accept(WorkshopPlans.json("autoDiagnosis", true, "status", "error", "error", errorMessage(failure)));
        }
    }

    private void verifyWorkshop(JsonObject request, MinecraftInstaller.Progress progress) throws IOException, InterruptedException {
        WorkshopVerification.ensureIdle();
        java.time.Instant started = java.time.Instant.now();
        new InstalledGameLauncher(dataRoot).launch(request, runtimes, microsoft, external, progress,
            (process, log, game, title) -> {
                GameWindowTitle.watch(process, title);
                WorkshopVerification.observe(process, log, game, started, progress::stopped);
            });
    }

    private boolean scheduleModScan(Path root, JsonObject request, java.util.concurrent.ExecutorService queue, Browser browser,
                                    DesktopFrontend frontend, Display display) {
        String id = required(request, "id");
        String key = root + "\0" + id;
        long generation = scanSequence.incrementAndGet();
        if (modScans.putIfAbsent(key, generation) != null) return false;
        queue.execute(() -> {
            java.util.function.Consumer<JsonObject> emit = event -> {
                if (display.isDisposed()) return;
                var output = DesktopUpdates.fields("modUpdateScan", event);
                if (request.has("directoryId")) output.add("directoryId", request.get("directoryId"));
                display.asyncExec(() -> {
                    if (!browser.isDisposed() && frontend.owns(browser.getUrl())) {
                        browser.execute("window.kynexDesktopEvent('kynex-progress'," + IPC.toJson(output) + ")");
                    }
                });
            };
            try {
                JsonObject cached = request.deepCopy();
                cached.addProperty("cacheOnly", true);
                JsonArray reused = modUpdates.check(root, dataRoot, cached);
                if (!reused.isEmpty()) emit.accept(DesktopUpdates.fields("id", id, "generation", generation, "status", "cached", "rows", reused));
                emit.accept(DesktopUpdates.fields("id", id, "generation", generation, "status", "checking"));
                JsonArray rows = modUpdates.check(root, dataRoot, request);
                emit.accept(DesktopUpdates.fields("id", id, "generation", generation, "status", "done", "rows", rows));
            } catch (InterruptedException stopped) { Thread.currentThread().interrupt(); }
            catch (Exception error) { emit.accept(DesktopUpdates.fields("id", id, "generation", generation, "status", "error", "error", errorMessage(error))); }
            finally { modScans.remove(key, generation); }
        });
        return true;
    }
}
