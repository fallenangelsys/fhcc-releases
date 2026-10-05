package de.fallenheaven.controlcenter;

import android.content.Context;
import android.os.Build;
import android.util.Log;

import org.json.JSONObject;

import java.io.File;

/**
 * Native Bruecke fuer die sichere Einrichtung.
 *
 * Am Desktop uebernimmt das Electron-Fenster setup.html die Zugangsdaten und
 * legt sie ueber safeStorage (Windows DPAPI) ab. Diese Datei gibt es unter
 * Android nicht - der Bridge meldet fuer saveCredentials und deleteBotToken
 * daher bewusst "nur am Desktop".
 *
 * Damit der Bot trotzdem eingerichtet werden kann, gibt es diesen Weg:
 * Der Nutzer traegt Token und OAuth-Daten in einem nativen Dialog ein, sie
 * wandern in den Android-Keystore, und der Node-Prozess holt sie beim Start.
 */
public class SetupBridge {

    private static final String TAG = "FHCCSetup";

    private final Context context;

    public SetupBridge(Context context) {
        this.context = context.getApplicationContext();
    }

    /** Wird von der Weboberflaeche ueber eine eigene Nachricht aufgerufen. */
    public boolean handle(String action, String payloadJson, StringBuilder responseJson) {
        try {
            JSONObject payload = payloadJson == null ? new JSONObject() : new JSONObject(payloadJson);
            JSONObject response = new JSONObject();
            response.put("ok", true);

            switch (action) {
                case "setup.status":
                    response.put("configured", isConfigured());
                    response.put("hasToken", SecureStore.get(context, "discord_token") != null);
                    response.put("hasClientId", SecureStore.get(context, "discord_client_id") != null);
                    response.put("hasClientSecret", SecureStore.get(context, "discord_client_secret") != null);
                    response.put("keyStoreAvailable", isKeyStoreAvailable());
                    break;

                case "setup.save":
                    saveSecrets(payload);
                    response.put("configured", isConfigured());
                    break;

                case "setup.clear":
                    clearSecrets();
                    response.put("configured", false);
                    break;

                default:
                    response.put("ok", false);
                    response.put("error", "Unbekannte Aktion: " + action);
                    break;
            }

            responseJson.append(response.toString());
            return true;
        } catch (Exception error) {
            Log.e(TAG, "Aktion fehlgeschlagen: " + action, error);
            try {
                JSONObject response = new JSONObject();
                response.put("ok", false);
                response.put("error", String.valueOf(error.getMessage()));
                responseJson.append(response.toString());
            } catch (Exception ignored) {
                responseJson.append("{\"ok\":false,\"error\":\"Interner Fehler\"}");
            }
            return true;
        }
    }

    /**
     * Loescht die gespeicherten Zugangsdaten. Wird von der App beim Abmelden
     * aufgerufen und entfernt auch die .env, die der Node-Prozess liest.
     */
    public void clearSecrets() {
        SecureStore.clear(context);
        // Der Node-Prozess liest die Zugangsdaten aus dieser Datei. Bleibt sie
        // liegen, waeren die Daten nach dem Abmelden weiterhin auf der Platte.
        new File(context.getFilesDir(), ".env").delete();
    }

    private void saveSecrets(JSONObject payload) throws Exception {
        String token = payload.optString("token", "").trim();
        String clientId = payload.optString("clientId", "").trim();
        String clientSecret = payload.optString("clientSecret", "").trim();

        if (!token.isEmpty()) SecureStore.put(context, "discord_token", token);
        if (!clientId.isEmpty()) SecureStore.put(context, "discord_client_id", clientId);
        if (!clientSecret.isEmpty()) SecureStore.put(context, "discord_client_secret", clientSecret);
    }

    public boolean isConfigured() {
        return SecureStore.get(context, "discord_token") != null
                && SecureStore.get(context, "discord_client_id") != null;
    }

    private boolean isKeyStoreAvailable() {
        try {
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M;
        } catch (Exception ignored) {
            return false;
        }
    }
}
