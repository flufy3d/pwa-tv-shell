import groovy.json.JsonSlurper
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// 每个网页应用一份配置：build.ps1 先把 apps/<name>.json 解析成 build/gen/<name>/（资源、assets、build.json），
// 再用 -Papp=<name> 调用 Gradle。这里只读 build.json 里的包名/版本/方向，其余运行期配置在 assets 里。
val appName = (findProperty("app") as String?) ?: "_sample"
val genDir = rootProject.layout.projectDirectory.dir("build/gen/$appName").asFile
val buildJson = genDir.resolve("build.json")
@Suppress("UNCHECKED_CAST")
val gen: Map<String, Any?> = if (buildJson.isFile) JsonSlurper().parse(buildJson) as Map<String, Any?> else emptyMap()

val keystoreDir = rootProject.file("keystore")
val keystoreProps = Properties().apply {
    val f = keystoreDir.resolve("keystore.properties")
    if (f.isFile) f.inputStream().use { load(it) }
}

android {
    namespace = "io.github.flufy3d.tvshell"
    compileSdk = 36

    defaultConfig {
        applicationId = gen["applicationId"] as String? ?: "io.github.flufy3d.tvshell.sample"
        minSdk = 24
        targetSdk = 36
        versionCode = (gen["versionCode"] as Number?)?.toInt() ?: 1
        versionName = gen["versionName"] as String? ?: "1.0"
        manifestPlaceholders["screenOrientation"] = gen["orientation"] as String? ?: "landscape"
        buildConfigField("String", "SHELL_VERSION", "\"${gen["shellVersion"] ?: "dev"}\"")
    }

    signingConfigs {
        create("shell") {
            storeFile = keystoreDir.resolve("tvshell.jks")
            storePassword = keystoreProps.getProperty("storePassword")
            keyAlias = keystoreProps.getProperty("keyAlias")
            keyPassword = keystoreProps.getProperty("keyPassword")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (keystoreProps.isNotEmpty()) signingConfig = signingConfigs.getByName("shell")
        }
    }

    sourceSets["main"].res.srcDir(genDir.resolve("res"))
    sourceSets["main"].assets.srcDir(genDir.resolve("assets"))

    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin { jvmToolchain(17) }

dependencies {
    implementation("androidx.webkit:webkit:1.17.1")
}
