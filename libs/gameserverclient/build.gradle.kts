val ScalaBinary = "2.13"

plugins {
    application
    id("com.lightbend.akka.grpc.gradle").version("2.0.0")
}

application {
    mainClass.set("gameserver.client.GameServerDebugClientApplication")
}

dependencies {
    implementation("ch.qos.logback:logback-classic:1.2.3")
    implementation(project(":libs:gamedomain"))
    implementation(project(":libs:gamegrpc"))

    implementation(platform("com.typesafe.akka:akka-bom_$ScalaBinary:2.6.14"))
    implementation("com.typesafe.akka:akka-actor-typed_$ScalaBinary")
    implementation("com.typesafe.akka:akka-protobuf_$ScalaBinary")
}
