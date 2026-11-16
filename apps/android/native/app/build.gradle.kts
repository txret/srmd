import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
}

/** Read the same root version the web app and VS Code packaging use, including when Gradle runs directly. */
val repository_package = JsonSlurper().parse(rootProject.file("../../../package.json")) as Map<*, *>
val app_version = repository_package["version"] as String
/** Encode major.minor.patch in three decimal groups; suffixes do not change Android's numeric update order. */
val version_parts = app_version.substringBefore('-').substringBefore('+').split('.').map { it.toLong() }
require(version_parts.size == 3 && version_parts[0] >= 0 && version_parts[1] in 0..999 && version_parts[2] in 0..999) {
    "The root version must be major.minor.patch, with minor and patch below 1000"
}
val app_version_code = version_parts[0] * 1_000_000 + version_parts[1] * 1_000 + version_parts[2]
require(app_version_code in 1..2_100_000_000) { "The root version is outside Android's versionCode range" }

android {
    namespace = "opensource.txret.srmd"
    compileSdk = 36

    defaultConfig {
        applicationId = "opensource.txret.srmd"
        // Android 10: older versions are not supported, which keeps the shell free of compatibility paths.
        minSdk = 29
        targetSdk = 36
        versionCode = app_version_code.toInt()
        versionName = app_version
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
