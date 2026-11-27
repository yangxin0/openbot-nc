Pod::Spec.new do |s|
  s.name           = 'OpenBotRelayTls'
  s.version        = '1.0.0'
  s.summary        = 'TLS requests and WebSocket with the team root for OpenBot'
  s.description    = 'HTTPS requests and a WebSocket that trust the system authorities and the root of the team of the central server.'
  s.license        = 'PolyForm-Noncommercial-1.0.0'
  s.author         = 'OpenBot'
  s.homepage       = 'https://github.com/yangxin0/openbot-nc'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.swift"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
