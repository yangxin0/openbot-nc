import Foundation
import Network
import Security

enum RelayTlsFailure: Error {
  case untrusted(String)
  case network(String)
  case tooLarge
  case invalid(String)

  var code: String {
    switch self {
    case .untrusted: return "ERR_RELAY_TLS"
    case .network: return "ERR_RELAY_NETWORK"
    case .tooLarge: return "ERR_RELAY_TOO_LARGE"
    case .invalid: return "ERR_RELAY_REQUEST"
    }
  }

  var message: String {
    switch self {
    case .untrusted(let detail): return detail
    case .network(let detail): return detail
    case .tooLarge: return "The answer is too large."
    case .invalid(let detail): return detail
    }
  }
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
}

final class RelayTrustVerdict {
  private let lock = NSLock()
  private var refusedTrust = false

  var refused: Bool {
    lock.lock()
    defer { lock.unlock() }
    return refusedTrust
  }

  func refuse() {
    lock.lock()
    refusedTrust = true
    lock.unlock()
  }

  func failure(_ error: NWError) -> RelayTlsFailure {
    if refused { return .untrusted("The certificate of the server is not trusted.") }
    if case .tls = error { return .untrusted(error.localizedDescription) }
    return .network(error.localizedDescription)
  }
}

enum RelayTlsParameters {
  static func make(host: String, anchors: [SecCertificate], verify: Bool, verdict: RelayTrustVerdict) -> NWParameters {
    let tls = NWProtocolTLS.Options()
    let queue = DispatchQueue(label: "app.openbotnc.relay-tls.verify")
    sec_protocol_options_set_verify_block(
      tls.securityProtocolOptions,
      { _, trust, complete in
        guard verify else {
          complete(true)
          return
        }
        let accepted = RelayTrust.accepts(sec_trust_copy_ref(trust).takeRetainedValue(), host: host, anchors: anchors)
        if !accepted { verdict.refuse() }
        complete(accepted)
      },
      queue
    )
    return NWParameters(tls: tls, tcp: NWProtocolTCP.Options())
  }
}

final class RelayHttpExchange {
  private static let headerAllowance = 16 * 1024
  private static let separator = Data("\r\n\r\n".utf8)
  private static let lineEnd = Data("\r\n".utf8)

  private let connection: NWConnection
  private let queue = DispatchQueue(label: "app.openbotnc.relay-tls.http")
  private let request: Data
  private let limit: Int
  private let verdict: RelayTrustVerdict
  private let completion: (Result<(Int, Data), RelayTlsFailure>) -> Void
  private let lock = NSLock()
  private var received = Data()
  private var finished = false

  private init(
    connection: NWConnection,
    request: Data,
    limit: Int,
    verdict: RelayTrustVerdict,
    completion: @escaping (Result<(Int, Data), RelayTlsFailure>) -> Void
  ) {
    self.connection = connection
    self.request = request
    self.limit = limit
    self.verdict = verdict
    self.completion = completion
  }

  static func run(
    url: String,
    method: String,
    headers: [String: String],
    body: String?,
    root: String?,
    verify: Bool,
    limit: Int,
    timeoutMs: Double,
    completion: @escaping (Result<(Int, Data), RelayTlsFailure>) -> Void
  ) {
    guard let target = URL(string: url), target.scheme == "https", let host = target.host, !host.isEmpty,
      let components = URLComponents(url: target, resolvingAgainstBaseURL: false),
      let port = NWEndpoint.Port(rawValue: UInt16(clamping: target.port ?? 443))
    else {
      completion(.failure(.invalid("The address is not valid.")))
      return
    }
    let verdict = RelayTrustVerdict()
    let parameters = RelayTlsParameters.make(
      host: host,
      anchors: RelayTrust.certificates(root),
      verify: verify,
      verdict: verdict
    )
    let connection = NWConnection(host: NWEndpoint.Host(host), port: port, using: parameters)
    let exchange = RelayHttpExchange(
      connection: connection,
      request: requestBytes(
        method: method,
        target: components,
        host: host,
        port: target.port ?? 443,
        headers: headers,
        body: body
      ),
      limit: limit,
      verdict: verdict,
      completion: completion
    )
    exchange.start(timeoutMs: timeoutMs)
  }

  private static func requestBytes(
    method: String,
    target: URLComponents,
    host: String,
    port: Int,
    headers: [String: String],
    body: String?
  ) -> Data {
    let path = target.percentEncodedPath.isEmpty ? "/" : target.percentEncodedPath
    let query = target.percentEncodedQuery.map { "?\($0)" } ?? ""
    let hostName = host.contains(":") ? "[\(host)]" : host
    let authority = port == 443 ? hostName : "\(hostName):\(port)"
    let payload = body.map { Data($0.utf8) }
    var lines = ["\(clean(method)) \(path)\(query) HTTP/1.1", "Host: \(authority)", "Connection: close"]
    for (name, value) in headers where name.lowercased() != "host" && name.lowercased() != "content-length" {
      lines.append("\(clean(name)): \(clean(value))")
    }
    if let payload { lines.append("Content-Length: \(payload.count)") }
    var data = Data((lines.joined(separator: "\r\n") + "\r\n\r\n").utf8)
    if let payload { data.append(payload) }
    return data
  }

  private static func clean(_ text: String) -> String {
    text.filter { $0 != "\r" && $0 != "\n" }
  }

  private func start(timeoutMs: Double) {
    connection.stateUpdateHandler = { [self] state in
      switch state {
      case .ready:
        connection.send(
          content: request,
          completion: .contentProcessed { [self] error in
            if let error {
              finish(.failure(verdict.failure(error)))
              return
            }
            receive()
          }
        )
      case .failed(let error), .waiting(let error):
        finish(.failure(verdict.failure(error)))
      default:
        break
      }
    }
    connection.start(queue: queue)
    queue.asyncAfter(deadline: .now() + max(1, timeoutMs / 1000)) { [self] in
      finish(.failure(.network("The server did not answer in time.")))
    }
  }

  private func receive() {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [self] data, _, isComplete, error in
      if let data { received.append(data) }
      if received.count > limit + Self.headerAllowance {
        finish(.failure(.tooLarge))
        return
      }
      if let answer = Self.answer(received, ended: isComplete || error != nil) {
        if answer.1.count > limit {
          finish(.failure(.tooLarge))
        } else {
          finish(.success(answer))
        }
        return
      }
      if let error {
        finish(.failure(verdict.failure(error)))
        return
      }
      if isComplete {
        finish(.failure(.network("The server sent an answer that is not complete.")))
        return
      }
      receive()
    }
  }

  private func finish(_ result: Result<(Int, Data), RelayTlsFailure>) {
    lock.lock()
    if finished {
      lock.unlock()
      return
    }
    finished = true
    lock.unlock()
    connection.stateUpdateHandler = nil
    connection.cancel()
    completion(result)
  }

  static func answer(_ data: Data, ended: Bool) -> (Int, Data)? {
    guard let split = data.range(of: separator) else { return nil }
    let head = String(decoding: data[data.startIndex..<split.lowerBound], as: UTF8.self)
    let lines = head.components(separatedBy: "\r\n")
    guard let statusLine = lines.first else { return nil }
    let parts = statusLine.split(separator: " ")
    guard parts.count >= 2, parts[0].hasPrefix("HTTP/"), let status = Int(parts[1]) else { return nil }
    var headers: [String: String] = [:]
    for line in lines.dropFirst() {
      guard let colon = line.firstIndex(of: ":") else { continue }
      let name = line[line.startIndex..<colon].trimmingCharacters(in: .whitespaces).lowercased()
      headers[name] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
    }
    let body = Data(data[split.upperBound...])
    if headers["transfer-encoding"]?.lowercased().contains("chunked") == true {
      return dechunk(body).map { (status, $0) }
    }
    if let length = headers["content-length"].flatMap({ Int($0) }) {
      return body.count >= length ? (status, Data(body.prefix(length))) : nil
    }
    return ended ? (status, body) : nil
  }

  private static func dechunk(_ data: Data) -> Data? {
    var output = Data()
    var index = data.startIndex
    while true {
      guard let end = data.range(of: lineEnd, in: index..<data.endIndex) else { return nil }
      let sizeText = String(decoding: data[index..<end.lowerBound], as: UTF8.self)
        .split(separator: ";").first.map(String.init) ?? ""
      guard let size = Int(sizeText.trimmingCharacters(in: .whitespaces), radix: 16) else { return nil }
      index = end.upperBound
      if size == 0 { return output }
      guard data.distance(from: index, to: data.endIndex) >= size + 2 else { return nil }
      let chunkEnd = data.index(index, offsetBy: size)
      output.append(data[index..<chunkEnd])
      index = data.index(chunkEnd, offsetBy: 2)
    }
  }
}

final class RelayWebSocket {
  let id: String
  private let url: URL
  private let host: String
  private let anchors: [SecCertificate]
  private let emit: (String, [String: Any]) -> Void
  private let ended: (String) -> Void
  private let queue = DispatchQueue(label: "app.openbotnc.relay-tls.socket")
  private let verdict = RelayTrustVerdict()
  private let lock = NSLock()
  private var connection: NWConnection?
  private var finished = false

  init(
    id: String,
    url: URL,
    host: String,
    anchors: [SecCertificate],
    emit: @escaping (String, [String: Any]) -> Void,
    ended: @escaping (String) -> Void
  ) {
    self.id = id
    self.url = url
    self.host = host
    self.anchors = anchors
    self.emit = emit
    self.ended = ended
  }

  func open() {
    let parameters = RelayTlsParameters.make(host: host, anchors: anchors, verify: true, verdict: verdict)
    let options = NWProtocolWebSocket.Options()
    options.autoReplyPing = true
    options.maximumMessageSize = 16 * 1024 * 1024
    parameters.defaultProtocolStack.applicationProtocols.insert(options, at: 0)
    let connection = NWConnection(to: .url(url), using: parameters)
    lock.lock()
    self.connection = connection
    lock.unlock()
    connection.stateUpdateHandler = { [weak self] state in
      guard let self else { return }
      switch state {
      case .ready:
        self.emit("onSocketOpen", ["id": self.id])
        self.receive(connection)
      case .failed(let error), .waiting(let error):
        self.finish(code: 1006, reason: self.verdict.failure(error).message)
      case .cancelled:
        self.finish(code: 1006, reason: "")
      default:
        break
      }
    }
    connection.start(queue: queue)
  }

  func sendText(_ text: String) {
    send(Data(text.utf8), opcode: .text, units: text.utf16.count)
  }

  func sendBinary(_ data: Data) {
    send(data, opcode: .binary, units: data.count)
  }

  func close(code: Int, reason: String) {
    guard let connection = current() else { return }
    let metadata = NWProtocolWebSocket.Metadata(opcode: .close)
    metadata.closeCode = Self.closeCode(code)
    let context = NWConnection.ContentContext(identifier: "close", metadata: [metadata])
    connection.send(
      content: Data(reason.utf8),
      contentContext: context,
      isComplete: true,
      completion: .contentProcessed { [weak self] _ in self?.finish(code: code, reason: reason) }
    )
  }

  private func current() -> NWConnection? {
    lock.lock()
    defer { lock.unlock() }
    return finished ? nil : connection
  }

  private func send(_ data: Data, opcode: NWProtocolWebSocket.Opcode, units: Int) {
    guard let connection = current() else { return }
    let metadata = NWProtocolWebSocket.Metadata(opcode: opcode)
    let context = NWConnection.ContentContext(identifier: "message", metadata: [metadata])
    connection.send(
      content: data,
      contentContext: context,
      isComplete: true,
      completion: .contentProcessed { [weak self] error in
        guard let self else { return }
        if let error {
          self.finish(code: 1006, reason: error.localizedDescription)
          return
        }
        self.emit("onSocketSent", ["id": self.id, "units": units])
      }
    )
  }

  private func receive(_ connection: NWConnection) {
    connection.receiveMessage { [weak self] content, context, _, error in
      guard let self else { return }
      if let error {
        self.finish(code: 1006, reason: error.localizedDescription)
        return
      }
      let metadata =
        context?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata
      switch metadata?.opcode {
      case .text:
        self.emit("onSocketText", ["id": self.id, "text": String(decoding: content ?? Data(), as: UTF8.self)])
      case .binary:
        self.emit("onSocketBinary", ["id": self.id, "data": (content ?? Data()).base64EncodedString()])
      case .close:
        let code = metadata.map { Self.closeValue($0.closeCode) } ?? 1005
        self.finish(code: code, reason: String(decoding: content ?? Data(), as: UTF8.self))
        return
      default:
        break
      }
      self.receive(connection)
    }
  }

  private func finish(code: Int, reason: String) {
    lock.lock()
    if finished {
      lock.unlock()
      return
    }
    finished = true
    let connection = self.connection
    self.connection = nil
    lock.unlock()
    connection?.stateUpdateHandler = nil
    connection?.cancel()
    emit("onSocketClose", ["id": id, "code": code, "reason": reason])
    ended(id)
  }

  private static func closeCode(_ value: Int) -> NWProtocolWebSocket.CloseCode {
    guard let raw = UInt16(exactly: value), let defined = NWProtocolWebSocket.CloseCode.Defined(rawValue: raw) else {
      return .protocolCode(.normalClosure)
    }
    return .protocolCode(defined)
  }

  private static func closeValue(_ code: NWProtocolWebSocket.CloseCode) -> Int {
    switch code {
    case .protocolCode(let defined): return Int(defined.rawValue)
    case .applicationCode(let value): return Int(value)
    case .privateCode(let value): return Int(value)
    @unknown default: return 1006
    }
  }
}
