# Die WebView erreicht die App nicht direkt, daher nur Standardregeln.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-dontwarn org.slf4j.**
