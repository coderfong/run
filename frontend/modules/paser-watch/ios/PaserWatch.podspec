# The iPhone half of PASER's Apple Watch link: WatchConnectivity, bridged to
# JavaScript as the `PaserWatch` Expo module (see src/watch/ and
# docs/APPLE_WATCH.md). The watch half is the SwiftUI app in targets/watch/.
Pod::Spec.new do |s|
  s.name           = 'PaserWatch'
  s.version        = '1.0.0'
  s.summary        = 'Apple Watch link for PASER'
  s.description    = 'Mirrors the live run to the PASER watch app and relays its controls.'
  s.author         = ''
  s.homepage       = 'https://gameablestudios.com'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WatchConnectivity'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
