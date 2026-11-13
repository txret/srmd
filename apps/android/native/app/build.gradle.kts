plugins {
    id("com.android.application")
}

android {
    namespace = "opensource.txret.srmd"
    compileSdk = 36

    defaultConfig {
        applicationId = "opensource.txret.srmd"
        // Android 10: older versions are not supported, which keeps the shell free of compatibility paths.
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    /*
     * The debug keystore named in ~/.gradle/gradle.properties (DEBUG_STORE_FILE, DEBUG_STORE_PASS, DEBUG_KEY_ALIAS,
     * DEBUG_KEY_PASS), so every machine signs debug builds with the same key and an installed APK can be updated.
     * Without DEBUG_STORE_FILE, Android's default debug keystore signs them.
     */
    val debug_store = findProperty("DEBUG_STORE_FILE") as String?
    if (debug_store != null) {
        signingConfigs.getByName("debug") {
            storeFile = file(debug_store)
            storePassword = findProperty("DEBUG_STORE_PASS") as String?
            keyAlias = findProperty("DEBUG_KEY_ALIAS") as String?
            keyPassword = findProperty("DEBUG_KEY_PASS") as String?
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.activity:activity:1.13.0")
    implementation("androidx.core:core-ktx:1.18.0")
    implementation("androidx.webkit:webkit:1.18.0")
    testImplementation("junit:junit:4.13.2")
    // Android's org.json is a stub on the JVM; unit tests of the message format need a real one.
    testImplementation("org.json:json:20260814")
}
