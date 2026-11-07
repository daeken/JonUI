// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "JonUI",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "landmarks-reference", targets: ["LandmarksReference"])
    ],
    targets: [
        .executableTarget(
            name: "LandmarksReference",
            path: "examples/landmarks",
            exclude: ["app.ts", "README.md"],
            sources: ["swift"],
            resources: [.copy("fixtures/landmarks.json")]
        )
    ]
)
