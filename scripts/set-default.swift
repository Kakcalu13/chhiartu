import AppKit
import UniformTypeIdentifiers

// Sets "Markdown Viewer" as the default application for Markdown file types.
let appPath = "/Applications/Markdown Viewer.app"
let appURL = URL(fileURLWithPath: appPath)

guard FileManager.default.fileExists(atPath: appPath) else {
    FileHandle.standardError.write("App not found at \(appPath)\n".data(using: .utf8)!)
    exit(1)
}

let exts = ["md", "markdown", "mdown", "mkd", "mdx", "markdn"]
let ws = NSWorkspace.shared

for ext in exts {
    guard let type = UTType(filenameExtension: ext) else {
        print("skip .\(ext): no UTType")
        continue
    }
    let sem = DispatchSemaphore(value: 0)
    var setErr: Error?
    ws.setDefaultApplication(at: appURL, toOpen: type) { error in
        setErr = error
        sem.signal()
    }
    sem.wait()
    if let e = setErr {
        print("FAIL .\(ext) (\(type.identifier)): \(e.localizedDescription)")
    } else {
        // Verify what the system now reports as the handler.
        let handler = ws.urlForApplication(toOpen: type)
        let name = handler?.deletingPathExtension().lastPathComponent ?? "none"
        print("OK   .\(ext) (\(type.identifier)) -> \(name)")
    }
}
