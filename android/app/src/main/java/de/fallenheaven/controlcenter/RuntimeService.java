package de.fallenheaven.controlcenter;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;

/**
 * Haelt den Bot auf dem Geraet am Laufen.
 *
 * Der Dienst laeuft als Foreground-Service. Ohne das wuerde Android den
 * Node-Prozess beenden, sobald die App in den Hintergrund geraet - der Bot
 * waere offline und alle Module stuenden still.
 *
 * Der Start wartet aktiv auf den Health-Endpunkt. Ein blindes "gestartet"
 * wuerde der Oberflaeche einen Zustand vorspielen, den es nicht gibt.
 */
public class RuntimeService extends Service {

    private static final String TAG = "FHCCRuntime";
    private static final String CHANNEL_ID = "fhcc_runtime";
    private static final int NOTIFICATION_ID = 4211;

    private static final String ACTION_START = "de.fallenheaven.controlcenter.START";
    private static final String ACTION_STOP = "de.fallenheaven.controlcenter.STOP";

    private RuntimeProcess process;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;

        if (ACTION_STOP.equals(action)) {
            stopSelf();
            return START_NOT_STICKY;
        }

        // Vorlaeufige Meldung: Android verlangt eine Benachrichtigung sofort.
        startForeground(NOTIFICATION_ID, buildNotification("Bot wird gestartet ..."));

        if (process == null) {
            process = new RuntimeProcess(getApplicationContext());
        }

        if (process.isRunning()) {
            updateNotification("Bot laeuft");
            return START_STICKY;
        }

        final RuntimeProcess target = process;
        new Thread(() -> {
            String error = target.start();
            if (error == null) {
                updateNotification("Bot laeuft");
                Log.i(TAG, "Bot bereit");
            } else {
                updateNotification("Start fehlgeschlagen");
                Log.e(TAG, "Start fehlgeschlagen: " + error);
            }
        }, "fhcc-start").start();

        // START_STICKY: Nach Speicherdruck oder Doze startet Android den Dienst
        // neu. Sonst waere der Bot nach einem Ausschalten des Bildschirms weg.
        return START_STICKY;
    }

    /** Stellt sicher, dass der Prozess laeuft. Wird bei jedem App-Wechsel geprueft. */
    public static void ensureRunning(Context context) {
        Intent intent = new Intent(context, RuntimeService.class);
        intent.setAction(ACTION_START);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception error) {
            Log.e(TAG, "Dienst konnte nicht gestartet werden", error);
        }
    }

    /**
     * Der Phantom-Process-Killer ab Android 12 beendet Hintergrundprozesse,
     * sobald systemweit mehr als 32 davon laufen. Ein Foreground-Service
     * schuetzt davor nicht - er zaehlt selbst als einer. Der Startbildschirm
     * weist deshalb ab Android 12 auf die noetige Entwickleroption hin.
     *
     * Stoppt den Bot bewusst - entspricht dem Stopp-Knopf in der App.
     */
    public static void stop(Context context) {
        Intent intent = new Intent(context, RuntimeService.class);
        intent.setAction(ACTION_STOP);
        try {
            context.startService(intent);
        } catch (Exception ignored) {
            // Dienst ist bereits beendet - kein Fehler.
        }
    }

    private void updateNotification(String text) {
        try {
            NotificationManager manager =
                    (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.notify(NOTIFICATION_ID, buildNotification(text));
            }
        } catch (Exception ignored) {
            // Benachrichtigung ist nicht entscheidend fuer den Betrieb.
        }
    }

    private Notification buildNotification(String text) {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(
                this, 0, open, PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("FALLEN HEAVEN")
                .setContentText(text)
                .setSmallIcon(R.drawable.ic_fhcc_notification)
                .setContentIntent(pending)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager =
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Bot-Betrieb", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Haelt den Bot aktiv, solange die App geoeffnet ist.");
        manager.createNotificationChannel(channel);
    }

    @Override
    public void onDestroy() {
        if (process != null) {
            process.stop();
            process = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
