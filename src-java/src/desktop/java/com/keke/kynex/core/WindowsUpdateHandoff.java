package com.keke.kynex.core;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/** Runs outside the launcher's private runtime so Windows can replace it after exit. */
final class WindowsUpdateHandoff {
    static final String INSTALL_KEY = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Kynex Launcher";
    static final String FAILURE = "last-install-failure.txt";

    private WindowsUpdateHandoff() {}

    static void start(Path installer, String version) throws IOException {
        String command = ProcessHandle.current().info().command().orElse("");
        if (command.isBlank()) throw new IOException("无法确认启动器安装位置");
        Path launcher = Path.of(command).toRealPath();
        if (!launcher.getFileName().toString().equalsIgnoreCase("Kynex Launcher.exe")) {
            throw new IOException("只有已安装的启动器支持自动更新");
        }
        var shell = Path.of(System.getenv().getOrDefault("SystemRoot", "C:/Windows"),
            "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
        if (!Files.isRegularFile(shell)) throw new IOException("缺少 Windows 自动更新组件");
        var handoff = process(shell, installer, launcher, version, INSTALL_KEY);
        handoff.start();
    }

    static ProcessBuilder process(Path shell, Path installer, Path launcher, String version, String installKey) {
        String encoded = java.util.Base64.getEncoder().encodeToString(SCRIPT.getBytes(java.nio.charset.StandardCharsets.UTF_16LE));
        var handoff = new ProcessBuilder(shell.toString(), "-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encoded);
        handoff.directory(installer.getParent().toFile());
        handoff.redirectOutput(ProcessBuilder.Redirect.DISCARD);
        handoff.redirectError(ProcessBuilder.Redirect.DISCARD);
        var env = handoff.environment();
        env.put("KYNEX_UPDATE_INSTALLER", installer.toString());
        env.put("KYNEX_UPDATE_LAUNCHER", launcher.toString());
        env.put("KYNEX_UPDATE_VERSION", version.replaceFirst("^v", ""));
        env.put("KYNEX_UPDATE_REGISTRY", installKey);
        env.put("KYNEX_UPDATE_PID", Long.toString(ProcessHandle.current().pid()));
        return handoff;
    }

    private static final String SCRIPT = """
        $ErrorActionPreference = 'Stop'
        $installer = $env:KYNEX_UPDATE_INSTALLER
        $launcher = $env:KYNEX_UPDATE_LAUNCHER
        $registry = $env:KYNEX_UPDATE_REGISTRY
        $directory = Split-Path -LiteralPath $launcher
        $stage = Split-Path -LiteralPath $installer
        $failure = Join-Path (Split-Path -LiteralPath $stage) 'last-install-failure.txt'
        $safeToRestart = $false
        $result = 'failed'
        try {
            $deadline = [DateTime]::UtcNow.AddMinutes(2)
            do {
                $old = Get-Process -Id ([int]$env:KYNEX_UPDATE_PID) -ErrorAction SilentlyContinue
                $running = Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($launcher)) -ErrorAction SilentlyContinue |
                    Where-Object { $_.Path -eq $launcher }
                if (!$old -and !$running) { break }
                if ([DateTime]::UtcNow -ge $deadline) { throw 'launcher still running' }
                Start-Sleep -Milliseconds 250
            } while ($true)
            $safeToRestart = $true
            $existing = Get-ItemProperty -LiteralPath $registry
            $existingDir = (Get-Item -LiteralPath $existing.InstallLocation.Trim([char]34)).FullName
            if ($existingDir -ne $directory -or $existing.MainBinaryName -ne (Split-Path -Path $launcher -Leaf)) { throw 'install location' }
            $setup = Start-Process -FilePath $installer -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
            $installed = Get-ItemProperty -LiteralPath $registry
            $installedDir = (Get-Item -LiteralPath $installed.InstallLocation.Trim([char]34)).FullName
            if ($setup.ExitCode -ne 0 -or $installedDir -ne $directory -or
                $installed.DisplayVersion.TrimStart([char]118) -ne $env:KYNEX_UPDATE_VERSION) {
                throw ('installation did not complete (exit {0})' -f $setup.ExitCode)
            }
            $result = 'ok'
        } catch {
            [Console]::Error.WriteLine($_.Exception.Message)
            [IO.File]::WriteAllText($failure, $env:KYNEX_UPDATE_VERSION)
        } finally {
            if ($result -eq 'ok' -and (Test-Path -LiteralPath $failure)) { Remove-Item -LiteralPath $failure -Force -ErrorAction SilentlyContinue }
            if (Test-Path -LiteralPath $installer) { Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue }
            Set-Location -LiteralPath $directory
            if ((Test-Path -LiteralPath $stage) -and !(Get-ChildItem -LiteralPath $stage -Force | Select-Object -First 1)) {
                Remove-Item -LiteralPath $stage -ErrorAction SilentlyContinue
            }
            if ($safeToRestart -and (Test-Path -LiteralPath $launcher -PathType Leaf)) {
                Start-Process -FilePath $launcher -WorkingDirectory $directory
            }
        }
        if ($result -ne 'ok') { exit 1 }
        """;
}
