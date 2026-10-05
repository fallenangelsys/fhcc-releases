package de.fallenheaven.controlcenter;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Sichere Ablage fuer Discord-Token und OAuth-Daten.
 *
 * Am Desktop erledigt das Electron safeStorage ueber Windows DPAPI. Auf Android
 * gibt es DPAPI nicht - dort uebernimmt der Android-Keystore. Der Schluessel
 * liegt in der schluesselgeschuetzten Hardware des Geraets und kann das
 * KeyStore-Modul des Handys nicht verlassen.
 */
public final class SecureStore {

    private static final String KEY_ALIAS = "fhcc_secrets";
    private static final String PREFS = "fhcc_secure";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int IV_LENGTH = 12;
    private static final int TAG_BITS = 128;

    private SecureStore() {
    }

    public static void put(Context context, String key, String value) {
        if (value == null || value.isEmpty()) {
            remove(context, key);
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            byte[] encrypted = cipher.doFinal(value.getBytes("UTF-8"));
            byte[] iv = cipher.getIV();

            String payload = Base64.encodeToString(iv, Base64.NO_WRAP) + ":"
                    + Base64.encodeToString(encrypted, Base64.NO_WRAP);
            prefs(context).edit().putString(key, payload).apply();
        } catch (Exception ignored) {
            // Ohne sichere Ablage wird nichts gespeichert - lieber kein Token
            // im Klartext ablegen.
        }
    }

    public static String get(Context context, String key) {
        String payload = prefs(context).getString(key, null);
        if (payload == null) {
            return null;
        }
        try {
            String[] parts = payload.split(":", 2);
            if (parts.length != 2) {
                return null;
            }
            byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
            byte[] encrypted = Base64.decode(parts[1], Base64.NO_WRAP);

            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(TAG_BITS, iv));
            return new String(cipher.doFinal(encrypted), "UTF-8");
        } catch (Exception ignored) {
            // Schluessel nicht mehr vorhanden oder Daten beschaedigt.
            return null;
        }
    }

    public static void remove(Context context, String key) {
        prefs(context).edit().remove(key).apply();
    }

    public static void clear(Context context) {
        prefs(context).edit().clear().apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);

        KeyStore.Entry existing = keyStore.getEntry(KEY_ALIAS, null);
        if (existing instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) existing).getSecretKey();
        }

        KeyGenerator generator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }
}
