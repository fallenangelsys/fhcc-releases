package de.fallenheaven.controlcenter;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

/**
 * FALLEN HEAVEN Control Center fuer Android.
 *
 * Die App startet den vollstaendigen FHCC-Prozess (discord.js + SQLite +
 * Express) direkt auf dem Geraet und zeigt danach dessen Oberflaeche in einer
 * WebView. Es gibt keinen externen Server - alles laeuft lokal, genau wie am PC.
 *
 * Der Prozess laeuft als Foreground-Service, damit Android ihn nicht beendet.
 * Die WebView laedt von 127.0.0.1, also aus dem Loopback des eigenen Geraets.
 */
public class MainActivity extends AppCompatActivity {

    private static final String LOCAL_URL = "http://127.0.0.1:3000/app/";
    private static final int READY_TIMEOUT_MS = 60_000;
    private static final int POLL_MS = 900;

    private WebView webView;
    private View splash;
    private SetupBridge setupBridge;
    private RuntimeProcess runtime;
    private Handler handler = new Handler(Looper.getMainLooper());
    private long startedAt;
    private boolean ready;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);

        webView = new WebView(this);
        webView.setVisibility(View.GONE);
        webView.setBackgroundColor(Color.parseColor("#06071C"));
        setContentView(buildLayout());

        configureWebView();
        setupBridge = new SetupBridge(this);
        runtime = new RuntimeProcess(this);

        exposeNativeBridge();
        startedAt = System.currentTimeMillis();
        RuntimeService.ensureRunning(this);
        pollUntilReady();
    }

    private View buildLayout() {
        android.widget.LinearLayout root = new android.widget.LinearLayout(this);
        root.setOrientation(android.widget.LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#06071C"));

        webView.setLayoutParams(new android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT));
        root.addView(webView);

        splash = buildSplash();
        root.addView(splash);
        return root;
    }

    /** Startbildschirm, solange der Bot hochfaehrt. */
    private View buildSplash() {
        android.widget.LinearLayout box = new android.widget.LinearLayout(this);
        box.setOrientation(android.widget.LinearLayout.VERTICAL);
        box.setGravity(android.view.Gravity.CENTER);
        box.setPadding(48, 48, 48, 48);
        box.setBackgroundColor(Color.parseColor("#06071C"));

        android.widget.TextView mark = new android.widget.TextView(this);
        mark.setText("FH");
        mark.setTextSize(28);
        mark.setTextColor(Color.WHITE);
        mark.setGravity(android.view.Gravity.CENTER);

        android.widget.TextView title = new android.widget.TextView(this);
        title.setText("FALLEN HEAVEN");
        title.setTextSize(20);
        title.setTextColor(Color.WHITE);
        title.setGravity(android.view.Gravity.CENTER);
        android.widget.LinearLayout.LayoutParams titleParams =
                new android.widget.LinearLayout.LayoutParams(
                        android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                        android.widget.LinearLayout.LayoutParams.WRAP_CONTENT);
        titleParams.topMargin = 24;
        box.addView(title);

        android.widget.TextView status = new android.widget.TextView(this);
        status.setId(R.id.splash_status);
        status.setText("Bot wird gestartet ...");
        status.setTextSize(15);
        status.setTextColor(Color.parseColor("#9AA0C0"));
        status.setGravity(android.view.Gravity.CENTER);
        android.widget.LinearLayout.LayoutParams statusParams =
                new android.widget.LinearLayout.LayoutParams(
                        android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                        android.widget.LinearLayout.LayoutParams.WRAP_CONTENT);
        statusParams.topMargin = 12;
        box.addView(status);

        android.widget.Button retry = new android.widget.Button(this);
        retry.setId(R.id.splash_retry);
        retry.setText("Erneut versuchen");
        retry.setVisibility(View.GONE);
        retry.setOnClickListener(view -> {
            startedAt = System.currentTimeMillis();
            RuntimeService.ensureRunning(this);
            pollUntilReady();
        });
        android.widget.LinearLayout.LayoutParams retryParams =
                new android.widget.LinearLayout.LayoutParams(
                        android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
                        android.widget.LinearLayout.LayoutParams.WRAP_CONTENT);
        retryParams.topMargin = 28;
        box.addView(retry);

        android.widget.Button battery = new android.widget.Button(this);
        battery.setId(R.id.splash_battery);
        battery.setText("Bot am Laufen halten");
        battery.setVisibility(View.GONE);
        battery.setOnClickListener(view -> openBatterySettings());
        android.widget.LinearLayout.LayoutParams batteryParams =
                new android.widget.LinearLayout.LayoutParams(
                        android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
                        android.widget.LinearLayout.LayoutParams.WRAP_CONTENT);
        batteryParams.topMargin = 16;
        box.addView(battery);

        // Android 12+ beendet Hintergrundprozesse, sobald systemweit mehr als
        // 32 laufen. Ein Foreground-Service schuetzt nicht davor. Die
        // Entwickleroption muss der Nutzer selbst setzen - deshalb steht hier,
        // welcher Weg fuer welche Android-Version gilt.
        android.widget.TextView warning = new android.widget.TextView(this);
        warning.setId(R.id.splash_warning);
        warning.setVisibility(View.GONE);
        warning.setTextSize(12);
        warning.setTextColor(Color.parseColor("#FFD166"));
        android.widget.LinearLayout.LayoutParams warningParams =
                new android.widget.LinearLayout.LayoutParams(
                        android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                        android.widget.LinearLayout.LayoutParams.WRAP_CONTENT);
        warningParams.topMargin = 28;
        warningParams.leftMargin = 8;
        warningParams.rightMargin = 8;
        box.addView(warning);

        return box;
    }

    /**
     * Macht die native Einrichtung fuer die Weboberflaeche erreichbar.
     *
     * Am Desktop uebernimmt das Electron-Fenster das Speichern der Zugangsdaten.
     * Unter Android existiert dieses Fenster nicht, deshalb stellt die App die
     * Aktionen hier bereit und legt die Werte im Android-Keystore ab.
     */
    @android.webkit.JavascriptInterface
    public String fhNative(String action, String payloadJson) {
        StringBuilder response = new StringBuilder();
        try {
            setupBridge.handle(action, payloadJson, response);
        } catch (Exception error) {
            response.setLength(0);
            response.append("{\"ok\":false,\"error\":").append(JSONObject.quote(String.valueOf(error.getMessage()))).append("}");
        }
        return response.toString();
    }

    /** Termux installieren? Dann kann die Laufzeit auf dem Geraet liegen. */
    @android.webkit.JavascriptInterface
    public boolean fhHasRuntime() {
        RuntimeProcess probe = new RuntimeProcess(this);
        return probe.hasRuntime();
    }

    @android.webkit.JavascriptInterface
    public boolean fhTermuxInstalled() {
        return new RuntimeProcess(this).isTermuxInstalled();
    }

    private void exposeNativeBridge() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.KITKAT) {
            webView.addJavascriptInterface(this, "FHNative");
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        // Ausschliesslich lokale Inhalte: kein Cleartext von fremden Servern.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(false);
        }

        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (url == null) return true;
                boolean local = "127.0.0.1".equals(url.getHost()) || "localhost".equals(url.getHost());
                if (local) return false;

                // Discord OAuth im Systembrowser oeffnen, nicht im WebView.
                // Discord verbietet OAuth ausdruecklich in eingebetteten WebViews.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (Exception error) {
                    Toast.makeText(MainActivity.this,
                            "Link konnte nicht geoeffnet werden.", Toast.LENGTH_SHORT).show();
                }
                return true;
            }
        });
    }

    /** Wartet sichtbar auf den Bot, statt blind zu laden. */
    private void pollUntilReady() {
        handler.removeCallbacksAndMessages(null);
        handler.post(new Runnable() {
            @Override
            public void run() {
                if (isBotReady()) {
                    showApp();
                    return;
                }
                if (System.currentTimeMillis() - startedAt > READY_TIMEOUT_MS) {
                    showTimeout();
                    return;
                }
                handler.postDelayed(this, POLL_MS);
            }
        });
    }

    private boolean isBotReady() {
        if (ready) return true;
        try {
            java.net.HttpURLConnection connection =
                    (java.net.HttpURLConnection) new java.net.URL(
                            "http://127.0.0.1:3000/api/app/health").openConnection();
            connection.setConnectTimeout(1200);
            connection.setReadTimeout(1200);
            connection.setRequestProperty("x-fallen-heaven-app", "desktop-control-v2");
            int code = connection.getResponseCode();
            connection.disconnect();
            if (code != 200) return false;
            ready = true;
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private void showApp() {
        if (webView.getUrl() == null) {
            webView.loadUrl(LOCAL_URL);
        }
        splash.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
        keepScreenAwake(true);
    }

    private void showTimeout() {
        android.widget.TextView status = findViewById(R.id.splash_status);
        android.widget.Button retry = findViewById(R.id.splash_retry);
        android.widget.Button battery = findViewById(R.id.splash_battery);
        android.widget.TextView warning = findViewById(R.id.splash_warning);

        if (status != null) {
            status.setText("Der Bot antwortet nicht.\n\n"
                    + "Termux installieren und dort einmalig ausfuehren:\n"
                    + "  pkg install nodejs-lts");
        }
        if (retry != null) retry.setVisibility(View.VISIBLE);
        if (battery != null) battery.setVisibility(View.VISIBLE);

        if (warning != null && android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                warning.setText("Wichtig: Unter Einstellungen > Entwickleroptionen "
                        + "\"Disable child process restrictions\" einschalten.\n"
                        + "Sonst beendet Android den Bot nach einer Weile von selbst.");
            } else {
                warning.setText("Wichtig: Android 12/13 beendet den Bot im Hintergrund. "
                        + "Abhilfe gibt es hier nur per ADB-Befehl - die Anleitung "
                        + "steht in docs/android-app-plan.md.");
            }
            warning.setVisibility(View.VISIBLE);
        }
    }

    /**
     * Ohne diese Einstellung beendet Android den Dienst, sobald das Geraet
     * laengere Zeit im Standby ist - der Bot waere dann stumm.
     */
    private void openBatterySettings() {
        try {
            Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            startActivity(intent);
        } catch (Exception ignored) {
            try {
                startActivity(new Intent(Settings.ACTION_SETTINGS));
            } catch (Exception error) {
                Toast.makeText(this, "Einstellungen nicht erreichbar.", Toast.LENGTH_SHORT).show();
            }
        }
    }

    private void keepScreenAwake(boolean on) {
        if (on) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Nach einer Pause pruefen, ob der Prozess noch lebt.
        if (ready) {
            ready = isBotReady();
            if (!ready) {
                startedAt = System.currentTimeMillis();
                pollUntilReady();
            }
        }
    }

    @Override
    public void onBackPressed() {
        // In der App zurueck, nicht den Prozess beenden.
        if (webView.getVisibility() == View.VISIBLE && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
