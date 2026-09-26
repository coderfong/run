# Core Motion activity classification (walking / running / cycling /
# automotive / stationary) for PASER's run-session validity system, bridged
# to JavaScript as the `PaserMotion` Expo module (see src/run/motionActivity.js
# and docs/RUN_SESSION.md). One signal among several; never a verdict alone.
Pod::Spec.new do |s|
  s.name           = 'PaserMotion'
  s.version        = '1.0.0'
  s.summary        = 'Core Motion activity for PASER'
  s.description    = 'Queries CMMotionActivityManager history so a run can be classified by what the runner was doing.'
  s.author         = ''
  s.homepage       = 'https://gameablestudios.com'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CoreMotion'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
