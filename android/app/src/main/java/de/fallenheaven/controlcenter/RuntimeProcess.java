package de.fallenheaven.controlcenter;

import android.content.Context;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Startet den FHCC-Node-Prozess auf dem Geraet und wartet, bis er wirklich
 * bereit ist.
 *
 * Die Laufzeit liegt als libnode.so im nativeLibraryDir der installierten App.
 * Das ist der einzige Ort, von dem aus eine App unter Android 10+ (targetSdk 29)
 * ueberhaupt ein Programm starten darf - aus dem schreibbaren Datenverzeichnis
 * verbietet Android das Ausfuehren (W^X). Das System extrahiert Dateien aus
 * lib/<abi>/*.so beim Installieren selbst und legt sie ausfuehrbar ab.
 *
 * Termux als Alternative wurde entfernt: Android gibt der Termux-App keinen
 * Zugriff auf deren privates Verzeichnis. Weder kann sie unsere Dateien lesen
 * noch koennen wir ihre schreiben, weder ueber Dateipfade noch ueber die
 * RunCommandService-Schnittstelle. Ein Fremdprozess kann die Daten also weder
 * finden noch ablegen.
 *
 * Die JavaScript-Dateien liegen dagegen weiterhin im Datenverzeichnis - nur
 * ausfuehrbare Dateien sind dort verboten.
 */
public class RuntimeProcess {

    private static final String TAG = "FHCCProcess";
    private static final int PORT = 3000;
    private static final String TERMUX_PACKAGE = "com.termux";

    private final Context context;
    private final File dataDir;
    private Process process;
    private Thread logPump;
    private long startedAt;

    public RuntimeProcess(Context context) {
        this.context = context.getApplicationContext();
        this.dataDir = new File(context.getFilesDir(), "data");
    }

    public boolean isRunning() {
        return process != null && process.isAlive();
    }

    /** Liegt eine nutzbare Laufzeit vor? */
    public boolean hasRuntime() {
        return nativeNode() != null;
    }

    /**
     * Startet den Prozess und wartet auf den Health-Endpunkt.
     *
     * @return null bei Erfolg, sonst eine Meldung fuer die Oberflaeche.
     */
    public String start() {
        if (isRunning()) return null;

        try {
            ensureDirectories();
            restoreSecrets();

            File node = nativeNode();
            if (node == null) {
                return "Die Laufzeit liegt nicht im nativeLibraryDir.\n\n"
                        + "Die APK wurde ohne passende ABI gebaut oder die "
                        + "Installation ist unvollstaendig. Neu installieren "
                        + "loest das.";
            }

            if (!extractRuntimeSources()) {
                return "Backend und Oberflaeche konnten nicht entpackt werden.\n\n"
                        + "Bitte die App deinstallieren und neu installieren.";
            }

            List<String> command = new ArrayList<>(Arrays.asList(
                    node.getAbsolutePath(),
                    new File(rootDir(), "src/index.js").getAbsolutePath()));

            ProcessBuilder builder = new ProcessBuilder(command);
            builder.directory(rootDir());
            builder.redirectErrorStream(true);
            applyEnvironment(builder.environment());

            process = builder.start();
            startedAt = System.currentTimeMillis();
            startLogPump();
            // Kein process.pid(): die Methode gibt es in Androids
            // java.lang.Process nicht, auch nicht ab API 26.
            Log.i(TAG, "Prozess gestartet via " + node.getAbsolutePath());

            String waitError = waitUntilReady(45_000);
            if (waitError != null) {
                Log.e(TAG, "Start nicht bestaetigt: " + waitError);
                stop();
                return waitError;
            }
            return null;
        } catch (Exception error) {
            Log.e(TAG, "Start fehlgeschlagen", error);
            stop();
            return String.valueOf(error.getMessage());
        }
    }

    /** Wartet aktiv auf den Health-Endpunkt - blindes Warten waere fehleranfaellig. */
    private String waitUntilReady(int timeoutMs) {
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            if (!isRunning()) {
                return "Der Bot-Prozess wurde direkt nach dem Start beendet.";
            }
            if (isHealthy()) return null;
            sleep(600);
        }
        return "Der Bot antwortet nach 45 s nicht auf dem Port " + PORT + ".";
    }

    private boolean isHealthy() {
        try {
            java.net.HttpURLConnection connection =
                    (java.net.HttpURLConnection) new java.net.URL(
                            "http://127.0.0.1:" + PORT + "/api/app/health").openConnection();
            connection.setConnectTimeout(1500);
            connection.setReadTimeout(1500);
            connection.setRequestProperty("x-fallen-heaven-app", "desktop-control-v2");
            int code = connection.getResponseCode();
            connection.disconnect();
            return code == 200;
        } catch (Exception ignored) {
            return false;
        }
    }

    private void applyEnvironment(java.util.Map<String, String> env) {
        // Wichtigste Zeile: der Bot erkennt daran, dass er auf Android laeuft.
        env.put("FH_RUNTIME_PLATFORM", "android");
        // better-sqlite3 gibt es nicht fuer Android - node:sqlite ist eingebaut.
        env.put("FH_SQLITE_FLAVOUR", "node");
        env.put("NODE_ENV", "production");
        env.put("DASHBOARD_PORT", String.valueOf(PORT));
        env.put("FALLEN_HEAVEN_DATA_DIR", dataDir.getAbsolutePath());
        env.put("FALLEN_HEAVEN_RUNTIME_DIR", new File(context.getFilesDir(), "runtime").getAbsolutePath());
        // Nur Loopback: die App spricht ausschliesslich mit 127.0.0.1.
        env.put("FALLEN_HEAVEN_BIND_HOST", "127.0.0.1");
        env.put("HOME", context.getFilesDir().getAbsolutePath());
        env.put("TMPDIR", context.getCacheDir().getAbsolutePath());
        env.put("LANG", "de_DE.UTF-8");
    }

    private void ensureDirectories() throws IOException {
        File runtime = new File(context.getFilesDir(), "runtime");
        if (!runtime.exists() && !runtime.mkdirs()) {
            throw new IOException("Laufzeitordner konnte nicht angelegt werden.");
        }
        if (!dataDir.exists() && !dataDir.mkdirs()) {
            throw new IOException("Datenordner konnte nicht angelegt werden.");
        }
        File npm = new File(context.getFilesDir(), ".npm");
        if (!npm.exists()) {
            //noinspection ResultOfMethodCallIgnored
            npm.mkdirs();
        }
    }

    private File rootDir() {
        return context.getFilesDir();
    }

    /**
     * Die mitgelieferte Laufzeit aus dem nativeLibraryDir.
     *
     * Bewusst nicht aus dem Datenverzeichner und nicht aus den Assets: Android
     * verbietet dort seit Version 10 das Ausfuehren (W^X fuer targetSdk >= 29).
     * Ausfuehrbar sind nur Dateien, die das System selbst aus lib/<abi>/*.so
     * entpackt und in das nativeLibraryDir legt.
     */
    private File nativeNode() {
        String nativeDir = context.getApplicationInfo().nativeLibraryDir;
        if (nativeDir == null) return null;
        File binary = new File(nativeDir, "libnode.so");
        if (!binary.exists()) {
            Log.w(TAG, "libnode.so fehlt in " + nativeDir);
            return null;
        }
        binary.setExecutable(true, true);
        return binary;
    }

    /**
     * Entpackt Backend und Oberflaeche aus den Assets in den App-Speicher.
     *
     * Nur JavaScript und Daten - ausfuehrbare Dateien duerfen dort nicht liegen,
     * siehe nativeNode(). Nach dem ersten Start genuegt die Startdatei als
     * Merkmal, das Ganze wird nicht erneut kopiert.
     */
    private boolean extractRuntimeSources() {
        if (new File(rootDir(), "src/index.js").exists()) return true;
        Log.i(TAG, "Entpacke Backend und Oberflaeche aus den Assets ...");
        return copyAssetTree("runtime", rootDir());
    }

    private boolean copyAssetTree(String assetPath, File targetDir) {
        try {
            String[] children = context.getAssets().list(assetPath);
            if (children == null || children.length == 0) {
                return copyAssetFile(assetPath, targetDir);
            }
            if (!targetDir.exists() && !targetDir.mkdirs()) return false;
            for (String child : children) {
                if (!copyAssetTree(assetPath + "/" + child, new File(targetDir, child))) {
                    return false;
                }
            }
            return true;
        } catch (IOException error) {
            Log.e(TAG, "Assets konnten nicht entpackt werden: " + assetPath, error);
            return false;
        }
    }

    private boolean copyAssetFile(String assetPath, File target) {
        File parent = target.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) return false;
        try (InputStream asset = context.getAssets().open(assetPath);
             FileOutputStream out = new FileOutputStream(target)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = asset.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
            return true;
        } catch (IOException error) {
            Log.e(TAG, "Asset konnte nicht kopiert werden: " + assetPath, error);
            return false;
        }
    }

    /** Nur noch zur Anzeige in der Oberflaeche; der Start nutzt Termux nicht. */
    public boolean isTermuxInstalled() {
        try {
            context.getPackageManager().getPackageInfo(TERMUX_PACKAGE, 0);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    /**

     * Schreibt Zugangsdaten als .env neben die Daten. Sie kommen aus dem
     * Android-Keystore und werden hier nur im Klartext abgelegt, weil der
     * Node-Prozess sie sonst nicht lesen kann. Datei liegt im privaten
     * App-Speicher, nicht auf dem Datentraeger.
     */
    private void restoreSecrets() {
        String token = SecureStore.get(context, "discord_token");
        String clientId = SecureStore.get(context, "discord_client_id");
        String clientSecret = SecureStore.get(context, "discord_client_secret");

        if (token == null && clientId == null && clientSecret == null) return;

        StringBuilder content = new StringBuilder();
        if (token != null) content.append("DISCORD_TOKEN=").append(token).append('\n');
        if (clientId != null) content.append("DISCORD_CLIENT_ID=").append(clientId).append('\n');
        if (clientSecret != null) content.append("DISCORD_CLIENT_SECRET=").append(clientSecret).append('\n');
        content.append("FALLEN_HEAVEN_DATA_DIR=").append(dataDir.getAbsolutePath()).append('\n');
        content.append("FH_SQLITE_FLAVOUR=node\n");
        content.append("FH_RUNTIME_PLATFORM=android\n");

        try (FileOutputStream out = new FileOutputStream(new File(rootDir(), ".env"))) {
            out.write(content.toString().getBytes("UTF-8"));
            new File(rootDir(), ".env").setReadable(false, false);
            new File(rootDir(), ".env").setReadable(true, true);
        } catch (IOException error) {
            Log.e(TAG, "Zugangsdaten konnten nicht geschrieben werden", error);
        }
    }

    public void stop() {
        if (process != null) {
            process.destroy();
            try {
                if (!process.waitFor(8, java.util.concurrent.TimeUnit.SECONDS)) {
                    process.destroyForcibly();
                }
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
            }
            process = null;
        }
        if (logPump != null) {
            logPump.interrupt();
            logPump = null;
        }
        startedAt = 0;
    }

    private void startLogPump() {
        logPump = new Thread(() -> {
            try (InputStream in = process.getInputStream();
                 BufferedReader reader = new BufferedReader(new InputStreamReader(in, "UTF-8"))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    Log.i(TAG, line);
                }
            } catch (IOException ignored) {
                // Prozess beendet.
            }
        }, "fhcc-log");
        logPump.setDaemon(true);
        logPump.start();
    }

    private void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
        }
    }
}
