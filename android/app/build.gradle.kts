import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.roborazzi)
}

// Firebase (push): the google-services plugin needs android/app/google-services.json, which is
// not in git. Without it the app builds and runs; push is simply off (see Docs/connect.md).
if (file("google-services.json").exists()) {
    apply(plugin = libs.plugins.google.services.get().pluginId)
}

// Release signing: android/keystore.properties (storeFile, storePassword, keyAlias, keyPassword)
// or YARD_KEYSTORE_FILE / YARD_KEYSTORE_PASSWORD / YARD_KEY_ALIAS / YARD_KEY_PASSWORD. Neither
// present → the release build stays unsigned (and still builds). Never commit a keystore.
val releaseSigning: Map<String, String>? = run {
    val propsFile = rootProject.file("keystore.properties")
    val fromFile: Map<String, String>? = if (propsFile.exists()) {
        val props = Properties()
        propsFile.inputStream().use { props.load(it) }
        listOf("storeFile", "storePassword", "keyAlias", "keyPassword")
            .associateWith { props.getProperty(it)?.trim().orEmpty() }
    } else {
        null
    }
    val fromEnv = mapOf(
        "storeFile" to System.getenv("YARD_KEYSTORE_FILE").orEmpty(),
        "storePassword" to System.getenv("YARD_KEYSTORE_PASSWORD").orEmpty(),
        "keyAlias" to System.getenv("YARD_KEY_ALIAS").orEmpty(),
        "keyPassword" to System.getenv("YARD_KEY_PASSWORD").orEmpty(),
    )
    listOfNotNull(fromFile, fromEnv).firstOrNull { values -> values.values.all { it.isNotEmpty() } }
}

android {
    namespace = "space.yardstore.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "space.yardstore.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    signingConfigs {
        if (releaseSigning != null) {
            create("release") {
                // A relative storeFile is relative to android/ (where keystore.properties lives).
                storeFile = rootProject.file(releaseSigning.getValue("storeFile"))
                storePassword = releaseSigning.getValue("storePassword")
                keyAlias = releaseSigning.getValue("keyAlias")
                keyPassword = releaseSigning.getValue("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            if (releaseSigning != null) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
        // Robolectric screen screenshots (src/test/.../screenshots): real resources + native graphics.
        unitTests.isIncludeAndroidResources = true
        unitTests.all { test ->
            test.maxHeapSize = "2g"
            test.systemProperty("robolectric.graphicsMode", "NATIVE")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.navigation.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.browser)
    implementation(libs.androidx.core.splashscreen)

    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.okhttp)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.osmdroid.android)

    // Push (FCM). Initialised only when google-services.json is present (see above).
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)

    // Screenshot smoke tests (Robolectric + Roborazzi). Record PNGs with -Proborazzi.test.record=true.
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.roborazzi.junit.rule)
    testImplementation(platform(libs.androidx.compose.bom))
    testImplementation(libs.androidx.compose.ui.test.junit4)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
