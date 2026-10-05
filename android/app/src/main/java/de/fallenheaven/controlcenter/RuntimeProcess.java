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
 * Der Weg ueber Termux ist der vorgesehene: Termux paketiert Node gegen
 * Bionic, also genau fuer Android. Die offizielle Linux-Binary von nodejs.org
 * laeuft hier nicht, weil sie /lib/ld-linux-aarch64.so.1 erwartet - diesen
 * Loader hat Android nicht. Eine eigene in der APK mitgelieferte Laufzeit ist
 * moeglich, aber nur als statisch gelinkte Binary.
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
        return findBundledNode() != null || findTermuxNode() != null;
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

            // Termux zuerst: das ist der realistische Weg auf einem Geraet.
            // Eine mitgelieferte Laufzeit gibt es nur, wenn sie statisch
            // gelinkt ist - prepare-runtime.mjs prueft das beim Bauen.
            String[] termux = findTermuxNode();
            File bundled = findBundledNode();
            List<String> command;

            if (termux != null) {
                // Termux-Dateien liegen im app_home. Der Bot schreibt aber in
                // unseren App-Speicher, deshalb bleibt das Arbeitsverzeichnis hier.
                command = new ArrayList<>(Arrays.asList(
                        termux[0],
                        new File(rootDir(), "src/index.js").getAbsolutePath()));
            } else if (bundled != null) {
                command = new ArrayList<>(Arrays.asList(
                        bundled.getAbsolutePath(),
                        new File(rootDir(), "src/index.js").getAbsolutePath()));
            } else {
                return "Keine Node-Laufzeit gefunden.\n\n"
                        + "Termux installieren und dort einmalig ausfuehren:\n"
                        + "  pkg install nodejs-lts\n\n"
                        + "Die Laufzeit muss gegen Android (Bionic) gebaut sein - "
                        + "die Linux-Binary von nodejs.org startet hier nicht.";
            }

            ProcessBuilder builder = new ProcessBuilder(command);
            builder.directory(rootDir());
            builder.redirectErrorStream(true);
            applyEnvironment(builder.environment());

            process = builder.start();
            startedAt = System.currentTimeMillis();
            startLogPump();
            Log.i(TAG, "Prozess gestartet, PID " + process.pid());

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

    private void ensureDirectories() {
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

    private File findBundledNode() {
        File binary = new File(rootDir(), "bin/node");
        if (!binary.exists()) {
            // Noch nicht entpackt? Dann aus dem Asset holen.
            if (!extractBundledRuntime()) return null;
        }
        if (!binary.exists()) return null;
        binary.setExecutable(true);
        return binary;
    }

    /**
     * Entpackt die Laufzeit aus dem APK. Wird nur einmal gebraucht, danach
     * existiert bin/node im App-Speicher.
     */
    private boolean extractBundledRuntime() {
        try (InputStream asset = context.getAssets().open("runtime/bin/node")) {
            File target = new File(rootDir(), "bin/node");
            File parent = target.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs()) return false;
            try (FileOutputStream out = new FileOutputStream(target)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = asset.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                }
            }
            target.setExecutable(true);
            return target.exists();
        } catch (IOException error) {
            // Kein Asset vorhanden - das ist der Normalfall, wenn Termux genutzt wird.
            Log.i(TAG, "Keine gebuendelte Laufzeit im APK: " + error.getMessage());
            return false;
        }
    }

    /**
     * Termux als Quelle. Der Pfad ist fest, weil Termux sein Home unter
     * /data/data/com.termux/files/home ablegt. Zurueckgegeben werden Pfad
     * zur Laufzeit und der Pfad zum Arbeitsverzeichnis von Termux.
     */
    private String[] findTermuxNode() {
        File home = new File("/data/data/" + TERMUX_PACKAGE + "/files/home");
        if (!home.exists()) return null;

        File[] candidates = {
                new File(home, "usr/bin/node"),
                new File(home, "usr/local/bin/node")
        };
        for (File candidate : candidates) {
            if (candidate.exists()) {
                candidate.setExecutable(true);
                return new String[]{candidate.getAbsolutePath(), home.getAbsolutePath()};
            }
        }
        return null;
    }

    /** Termux ist installiert - dann kann der Nutzer dort nodejs-lts nachinstallieren. */
    public boolean isTermuxInstalled() {
        try {
            context.getPackageManager().getPackageInfo(TERMUX_PACKAGE, 0);
            return true;
        } catch (Exception ignored) {
            return new File("/data/data/" + TERMUX_PACKAGE + "/files/home").exists();
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
