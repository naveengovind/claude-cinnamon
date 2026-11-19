// Runs the `cinnamon` command: the app is only a front end, so everything it shows comes from the CLI and everything
// it changes goes through it.
//
// Which `cinnamon` it runs, in order:
//   1. the one named in Contents/Resources/cli-path (written by `cinnamon app install`),
//   2. one installed in the usual places (~/.local/bin, Homebrew, ~/bin),
//   3. the one inside this app (Contents/Resources/cinnamon, in the downloadable app): used to set Cinnamon up, when
//      it is first copied to ~/.local/bin (see bootstrap), so updates never write inside the app.
import Foundation

struct CommandResult {
  let status: Int32
  let stdout: String
  let stderr: String
  var ok: Bool { status == 0 }
  /** What to show a person: the output, or the error when there is no output. */
  var text: String {
    let all = [stdout, stderr].map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    return all.joined(separator: "\n")
  }
}

enum CLI {
  static var home: String { FileManager.default.homeDirectoryForCurrentUser.path }

  /** Where `cinnamon` may be installed, most likely first. */
  static var installedCandidates: [String] {
    ["\(home)/.local/bin/cinnamon", "/opt/homebrew/bin/cinnamon", "/usr/local/bin/cinnamon", "\(home)/bin/cinnamon"]
  }

  /** The copy inside this app (the downloadable app has one). */
  static var bundled: String? {
    guard let url = Bundle.main.url(forResource: "cinnamon", withExtension: nil) else { return nil }
    return FileManager.default.isExecutableFile(atPath: url.path) ? url.path : nil
  }

  /** The `cinnamon` this app runs, or nil when there is none at all. */
  static func locate() -> String? {
    let fm = FileManager.default
    if let url = Bundle.main.url(forResource: "cli-path", withExtension: nil),
       let named = try? String(contentsOf: url, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
       !named.isEmpty, fm.isExecutableFile(atPath: named) {
      return named
    }
    if let found = installedCandidates.first(where: { fm.isExecutableFile(atPath: $0) }) { return found }
    return bundled
  }

  /** True when only the copy inside the app is there: Cinnamon isn't set up on this Mac yet. */
  static var onlyBundled: Bool { locate() != nil && locate() == bundled }

  /**
   * Copies the app's own `cinnamon` to ~/.local/bin, where `cinnamon update` can replace it without touching the
   * app. Returns the copy's path, or the error.
   */
  static func bootstrap() -> Result<String, Error> {
    guard let source = bundled else { return .failure(CLIError.missing) }
    let dir = "\(home)/.local/bin"
    let dest = "\(dir)/cinnamon"
    do {
      let fm = FileManager.default
      try fm.createDirectory(atPath: dir, withIntermediateDirectories: true)
      if fm.fileExists(atPath: dest) { try fm.removeItem(atPath: dest) }
      try fm.copyItem(atPath: source, toPath: dest)
      try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: dest)
      return .success(dest)
    } catch {
      return .failure(error)
    }
  }

  /** Runs `cinnamon <args>` off the main thread. */
  static func run(_ args: [String], using explicit: String? = nil) async -> CommandResult {
    guard let exe = explicit ?? locate() else {
      return CommandResult(status: 127, stdout: "", stderr: CLIError.missing.localizedDescription)
    }
    return await Task.detached(priority: .userInitiated) { runBlocking(exe, args) }.value
  }

  /** Runs it and waits: only ever called off the main thread (see run). */
  private static func runBlocking(_ exe: String, _ args: [String]) -> CommandResult {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: exe)
    p.arguments = args
    var env = ProcessInfo.processInfo.environment
    // a development checkout's `cinnamon` runs Bun, which a login item's minimal PATH lacks
    env["PATH"] = ["\(home)/.bun/bin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin", env["PATH"] ?? ""]
      .filter { !$0.isEmpty }.joined(separator: ":")
    env["NO_COLOR"] = "1"
    p.environment = env
    let out = Pipe(), err = Pipe()
    p.standardOutput = out
    p.standardError = err
    p.standardInput = FileHandle.nullDevice
    do { try p.run() } catch {
      return CommandResult(status: 126, stdout: "", stderr: "Could not run \(exe): \(error.localizedDescription)")
    }
    // read both pipes to the end before waiting, so a chatty command can't fill one and stall
    let group = DispatchGroup()
    var outData = Data(), errData = Data()
    group.enter()
    DispatchQueue.global().async { outData = out.fileHandleForReading.readDataToEndOfFile(); group.leave() }
    group.enter()
    DispatchQueue.global().async { errData = err.fileHandleForReading.readDataToEndOfFile(); group.leave() }
    group.wait()
    p.waitUntilExit()
    return CommandResult(status: p.terminationStatus,
                         stdout: String(decoding: outData, as: UTF8.self),
                         stderr: String(decoding: errData, as: UTF8.self))
  }

  /** Runs `cinnamon <args> --json` and decodes what it prints. */
  static func json<T: Decodable>(_ type: T.Type, _ args: [String]) async -> T? {
    let r = await run(args + ["--json"])
    guard let data = r.stdout.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
  }
}

enum CLIError: LocalizedError {
  case missing
  var errorDescription: String? {
    "The cinnamon command isn't installed. Download Cinnamon from github.com/naveengovind/claude-cinnamon/releases."
  }
}

// What `--json` prints (core/cli: status, theme list, ext list, doctor).

struct Status: Decodable {
  struct Helper: Decodable { let running: Bool; let built: Bool }
  struct Claude: Decodable { let installed: Bool; let running: Bool; let pid: Int? }
  let version: String
  let user: String
  let binary: String?
  let helper: Helper
  let claude: Claude
  let applied: Bool
  let theme: String
  let extensions: [String]
  /** Absent from versions before 0.4.3. */
  let permissions: Permissions?
}

/** Which macOS permissions Cinnamon uses (`cinnamon permissions --json`). */
struct Permissions: Decodable, Equatable {
  /** "accessibility" (turns itself on) or "none" (you turn on Claude's debugger). */
  let mode: String
  let closeChromeTab: Bool
}

struct ThemeList: Decodable {
  struct Theme: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let description: String
    let bundled: Bool
    let error: String?
  }
  let current: String
  let themes: [Theme]
}

struct ExtensionList: Decodable {
  struct Ext: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let description: String
    let bundled: Bool
    let enabled: Bool
    let errors: [String]
  }
  let extensions: [Ext]
}

/** `cinnamon browser list --json` (schema 1): the browsers this Mac has, and which run Cinnamon on claude.ai. */
struct BrowserList: Decodable {
  struct Browser: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    /** The browser is on this Mac. */
    let installed: Bool
    /** Cinnamon is set up for it (it can start Cinnamon for the extension). */
    let registered: Bool
    let extensionsUrl: String
    let hostManifest: String
  }
  let schema: Int
  let extensionId: String
  /** The folder a person loads as an unpacked extension. */
  let extensionDir: String
  let extensionBuilt: Bool
  /** The browser `cinnamon browser install` picks without --browser. */
  let defaultBrowser: String?
  let browsers: [Browser]

  enum CodingKeys: String, CodingKey {
    case schema, extensionId, extensionDir, extensionBuilt, browsers
    case defaultBrowser = "default"
  }

  var installed: [Browser] { browsers.filter(\.installed) }
  var missing: [Browser] { browsers.filter { !$0.installed } }
}

struct DoctorReport: Decodable {
  struct Check: Decodable, Identifiable, Hashable {
    let id: String
    let ok: Bool
    let text: String
    let fix: String?
  }
  let ok: Bool
  let problems: Int
  let checks: [Check]
  let notes: [String]
  func check(_ id: String) -> Check? { checks.first { $0.id == id } }
}
