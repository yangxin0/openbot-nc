import ExpoModulesCore
import Foundation

struct RelayRequestOptions: Record {
  @Field var method: String = "GET"
  @Field var headers: [String: String] = [:]
  @Field var body: String? = nil
  @Field var root: String? = nil
  @Field var verify: Bool = true
  @Field var limit: Int = 65_536
  @Field var timeoutMs: Double = 30_000
}

public final class RelayTlsModule: Module {
  private let lock = NSLock()
  private var sockets: [String: RelayWebSocket] = [:]

  public func definition() -> ModuleDefinition {
    Name("OpenBotRelayTls")

    Events("onSocketOpen", "onSocketText", "onSocketBinary", "onSocketSent", "onSocketClose")

    AsyncFunction("request") { (url: String, options: RelayRequestOptions, promise: Promise) in
      RelayHttpExchange.run(
        url: url,
        method: options.method,
        headers: options.headers,
        body: options.body,
        root: options.root,
        verify: options.verify,
        limit: options.limit,
        timeoutMs: options.timeoutMs
      ) { result in
        switch result {
        case .success(let answer):
          promise.resolve(["status": answer.0, "body": String(decoding: answer.1, as: UTF8.self)])
        case .failure(let failure):
          promise.reject(failure.code, failure.message)
        }
      }
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
    guard let target = URL(string: url), target.scheme == "wss", let host = target.host, !host.isEmpty else {
      sendEvent("onSocketClose", ["id": id, "code": 1006, "reason": "The address is not valid."])
      return
    }
    let socket = RelayWebSocket(
      id: id,
      url: target,
      host: host,
      anchors: RelayTrust.certificates(root),
      emit: { [weak self] name, body in self?.sendEvent(name, body) },
      ended: { [weak self] id in self?.forget(id) }
    )
    lock.lock()
    sockets[id] = socket
    lock.unlock()
    socket.open()
  }

  private func socket(_ id: String) -> RelayWebSocket? {
    lock.lock()
    defer { lock.unlock() }
    return sockets[id]
  }

  private func forget(_ id: String) {
    lock.lock()
    sockets[id] = nil
    lock.unlock()
  }

  private func takeSockets() -> [RelayWebSocket] {
    lock.lock()
    defer { lock.unlock() }
    let all = Array(sockets.values)
    sockets = [:]
    return all
  }
}
