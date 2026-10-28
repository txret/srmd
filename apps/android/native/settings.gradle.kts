// The Android shell of srmd: one activity around a WebView showing the web app, which `npm run build` in the parent
// folder writes into app/src/main/assets/web/. See ../ARCHITECTURE.md.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode = RepositoriesMode.FAIL_ON_PROJECT_REPOS
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "srmd"
include(":app")
