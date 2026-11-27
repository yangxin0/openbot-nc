import ExpoModulesCore
import Foundation
import Security

struct RelayRequestOptions: Record {
  @Field var method: String = "GET"
  @Field var headers: [String: String] = [:]
  @Field var body: String? = nil
  @Field var root: String? = nil
  @Field var verify: Bool = true
  @Field var limit: Int = 65_536
  @Field var timeoutMs: Double = 30_000
}

enum RelayTrust {
  static func certificates(_ pem: String?) -> [SecCertificate] {
    guard let pem else { return [] }
    var certificates: [SecCertificate] = []
    for part in pem.components(separatedBy: "-----END CERTIFICATE-----") {
      guard let begin = part.range(of: "-----BEGIN CERTIFICATE-----") else { continue }
      let body = String(part[begin.upperBound...].filter { !$0.isWhitespace })
      guard let der = Data(base64Encoded: body),
        let certificate = SecCertificateCreateWithData(nil, der as CFData)
      else { continue }
      certificates.append(certificate)
    }
    return certificates
  }

  static func accepts(_ trust: SecTrust, host: String, anchors: [SecCertificate]) -> Bool {
    SecTrustSetPolicies(trust, SecPolicyCreateSSL(true, host as CFString))
    if !anchors.isEmpty {
      SecTrustSetAnchorCertificates(trust, anchors as CFArray)
      SecTrustSetAnchorCertificatesOnly(trust, false)
    }
    return SecTrustEvaluateWithError(trust, nil)
  }

  static func isCertificateError(_ error: Error) -> Bool {
    let error = error as NSError
    return error.domain == NSURLErrorDomain && (-1206 ... -1200).contains(error.code)
  }
}

final class RelayTrustDecision {
  private let anchors: [SecCertificate]
  private let verify: Bool
  private let lock = NSLock()
  private var refusedTrust = false

  init(anchors: [SecCertificate], verify: Bool) {
    self.anchors = anchors
    self.verify = verify
  }

  var refused: Bool {
    lock.lock()
    defer { lock.unlock() }
    return refusedTrust
  }

  func answer(
    _ challenge: URLAuthenticationChallenge,
    _ completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
      let trust = challenge.protectionSpace.serverTrust
    else {
      completionHandler(.performDefaultHandling, nil)
      return
    }
    if !verify || RelayTrust.accepts(trust, host: challenge.protectionSpace.host, anchors: anchors) {
      completionHandler(.useCredential, URLCredential(trust: trust))
      return
    }
    lock.lock()
    refusedTrust = true
    lock.unlock()
    completionHandler(.cancelAuthenticationChallenge, nil)
  }
}

final class RelayRequestDelegate: NSObject, URLSessionTaskDelegate {
  let decision: RelayTrustDecision

  init(decision: RelayTrustDecision) {
    self.decision = decision
  }

  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    decision.answer(challenge, completionHandler)
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    decision.answer(challenge, completionHandler)
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }
}

enum RelayRequest {
  static func run(url: String, options: RelayRequestOptions, promise: Promise) {
    guard let target = URL(string: url), target.scheme == "https" else {
      promise.reject("ERR_RELAY_REQUEST", "The address is not valid.")
      return
    }
    var request = URLRequest(
      url: target,
      cachePolicy: .reloadIgnoringLocalCacheData,
      timeoutInterval: max(1, options.timeoutMs / 1000)
    )
    request.httpMethod = options.method
    for (name, value) in options.headers { request.setValue(value, forHTTPHeaderField: name) }
    if let body = options.body { request.httpBody = Data(body.utf8) }
    let decision = RelayTrustDecision(anchors: RelayTrust.certificates(options.root), verify: options.verify)
    let configuration = URLSessionConfiguration.ephemeral
    configuration.urlCache = nil
    let session = URLSession(
      configuration: configuration,
      delegate: RelayRequestDelegate(decision: decision),
      delegateQueue: nil
    )
    let limit = options.limit
    Task {
      defer { session.invalidateAndCancel() }
      do {
        let (bytes, response) = try await session.bytes(for: request)
        var data = Data()
        for try await byte in bytes {
          data.append(byte)
          if data.count > limit {
            promise.reject("ERR_RELAY_TOO_LARGE", "The answer is too large.")
            return
          }
        }
        promise.resolve([
          "status": (response as? HTTPURLResponse)?.statusCode ?? 0,
          "body": String(decoding: data, as: UTF8.self),
        ])
      } catch {
        let untrusted = decision.refused || RelayTrust.isCertificateError(error)
        promise.reject(untrusted ? "ERR_RELAY_TLS" : "ERR_RELAY_NETWORK", error.localizedDescription)
      }
    }
  }
}

final class RelaySocket: NSObject, URLSessionWebSocketDelegate {
  let id: String
  private let decision: RelayTrustDecision
  private let emit: (String, [String: Any]) -> Void
  private let ended: (String) -> Void
  private let lock = NSLock()
  private var session: URLSession?
  private var task: URLSessionWebSocketTask?
  private var finished = false

  init(
    id: String,
    anchors: [SecCertificate],
    emit: @escaping (String, [String: Any]) -> Void,
    ended: @escaping (String) -> Void
  ) {
    self.id = id
    self.decision = RelayTrustDecision(anchors: anchors, verify: true)
    self.emit = emit
    self.ended = ended
  }

  func open(_ url: URL) {
    let configuration = URLSessionConfiguration.default
    configuration.waitsForConnectivity = false
    configuration.urlCache = nil
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    let task = session.webSocketTask(with: url)
    task.maximumMessageSize = 16 * 1024 * 1024
    lock.lock()
    self.session = session
    self.task = task
    lock.unlock()
    task.resume()
  }

  func sendText(_ text: String) {
    send(.string(text), units: text.utf16.count)
  }

  func sendBinary(_ data: Data) {
    send(.data(data), units: data.count)
  }

  func close(code: Int, reason: String) {
    guard let task = currentTask() else { return }
    let closeCode = URLSessionWebSocketTask.CloseCode(rawValue: code) ?? .normalClosure
    task.cancel(with: closeCode, reason: reason.data(using: .utf8))
  }

  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    decision.answer(challenge, completionHandler)
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    decision.answer(challenge, completionHandler)
  }

  func urlSession(
    _ session: URLSession,
    webSocketTask: URLSessionWebSocketTask,
    didOpenWithProtocol protocol: String?
  ) {
    emit("onSocketOpen", ["id": id])
    receive(webSocketTask)
  }

  func urlSession(
    _ session: URLSession,
    webSocketTask: URLSessionWebSocketTask,
    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
    reason: Data?
  ) {
    finish(code: closeCode.rawValue, reason: reason.flatMap { String(data: $0, encoding: .utf8) } ?? "")
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    finish(code: 1006, reason: error?.localizedDescription ?? "")
  }

  private func currentTask() -> URLSessionWebSocketTask? {
    lock.lock()
    defer { lock.unlock() }
    return finished ? nil : task
  }

  private func send(_ message: URLSessionWebSocketTask.Message, units: Int) {
    guard let task = currentTask() else { return }
    task.send(message) { [weak self] error in
      guard let self else { return }
      if let error {
        self.finish(code: 1006, reason: error.localizedDescription)
        return
      }
      self.emit("onSocketSent", ["id": self.id, "units": units])
    }
  }

  private func receive(_ task: URLSessionWebSocketTask) {
    task.receive { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(.string(let text)):
        self.emit("onSocketText", ["id": self.id, "text": text])
        self.receive(task)
      case .success(.data(let data)):
        self.emit("onSocketBinary", ["id": self.id, "data": data.base64EncodedString()])
        self.receive(task)
      case .success:
        self.receive(task)
      case .failure:
        return
      }
    }
  }

  private func finish(code: Int, reason: String) {
    lock.lock()
    if finished {
      lock.unlock()
      return
    }
    finished = true
    let session = self.session
    self.session = nil
    self.task = nil
    lock.unlock()
    emit("onSocketClose", ["id": id, "code": code, "reason": reason])
    session?.invalidateAndCancel()
    ended(id)
  }
}

public final class RelayTlsModule: Module {
  private let lock = NSLock()
  private var sockets: [String: RelaySocket] = [:]

  public func definition() -> ModuleDefinition {
    Name("OpenBotRelayTls")

    Events("onSocketOpen", "onSocketText", "onSocketBinary", "onSocketSent", "onSocketClose")

    AsyncFunction("request") { (url: String, options: RelayRequestOptions, promise: Promise) in
      RelayRequest.run(url: url, options: options, promise: promise)
    }

    Function("openSocket") { (id: String, url: String, root: String?) in
      self.openSocket(id: id, url: url, root: root)
    }

    Function("sendText") { (id: String, text: String) in
      self.socket(id)?.sendText(text)
    }

    Function("sendBinary") { (id: String, data: String) in
      guard let bytes = Data(base64Encoded: data) else { return }
      self.socket(id)?.sendBinary(bytes)
    }

    Function("closeSocket") { (id: String, code: Int, reason: String) in
      self.socket(id)?.close(code: code, reason: reason)
    }

    OnDestroy {
      for socket in self.takeSockets() { socket.close(code: 1001, reason: "") }
    }
  }

  private func openSocket(id: String, url: String, root: String?) {
    guard let target = URL(string: url), target.scheme == "wss" else {
      sendEvent("onSocketClose", ["id": id, "code": 1006, "reason": "The address is not valid."])
      return
    }
    let socket = RelaySocket(
      id: id,
      anchors: RelayTrust.certificates(root),
      emit: { [weak self] name, body in self?.sendEvent(name, body) },
      ended: { [weak self] id in self?.forget(id) }
    )
    lock.lock()
    sockets[id] = socket
    lock.unlock()
    socket.open(target)
  }

  private func socket(_ id: String) -> RelaySocket? {
    lock.lock()
    defer { lock.unlock() }
    return sockets[id]
  }

  private func forget(_ id: String) {
    lock.lock()
    sockets[id] = nil
    lock.unlock()
  }

  private func takeSockets() -> [RelaySocket] {
    lock.lock()
    defer { lock.unlock() }
    let all = Array(sockets.values)
    sockets = [:]
    return all
  }
}
