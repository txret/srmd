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
