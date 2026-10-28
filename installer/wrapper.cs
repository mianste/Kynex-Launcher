using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        string baseDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string temp = Path.Combine(baseDir, "KynexLauncherTemp");
        string setup = Path.Combine(temp, "KynexLauncherSetup.exe");
        try
        {
            try
            {
                Directory.CreateDirectory(temp);
                string probe = Path.Combine(temp, "write-test.tmp");
                File.WriteAllText(probe, "ok");
                File.Delete(probe);
            }
            catch
            {
                temp = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "KynexLauncher",
                    "Temp"
                );
                Directory.CreateDirectory(temp);
                setup = Path.Combine(temp, "KynexLauncherSetup.exe");
            }

            using (Stream source = Assembly.GetExecutingAssembly().GetManifestResourceStream("SetupPayload"))
            {
                if (source == null)
                {
                    MessageBox.Show("安装程序数据不完整，请重新下载。", "Kynex Launcher");
                    return;
                }
                using (FileStream target = File.Create(setup))
                {
                    source.CopyTo(target);
                }
            }

            ProcessStartInfo start = new ProcessStartInfo(setup);
            start.UseShellExecute = false;
            start.WorkingDirectory = temp;
            start.EnvironmentVariables["TEMP"] = temp;
            start.EnvironmentVariables["TMP"] = temp;
            using (Process process = Process.Start(start))
            {
                if (process == null)
                {
                    MessageBox.Show("无法启动安装程序。", "Kynex Launcher");
                    return;
                }
                process.WaitForExit();
            }
        }
        catch (Exception error)
        {
            MessageBox.Show(
                "安装程序无法启动：\r\n" + error.Message,
                "Kynex Launcher",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }
        finally
        {
            try
            {
                if (File.Exists(setup)) File.Delete(setup);
            }
            catch { }
            try
            {
                if (Directory.Exists(temp)) Directory.Delete(temp, true);
            }
            catch { }
        }
    }
}
