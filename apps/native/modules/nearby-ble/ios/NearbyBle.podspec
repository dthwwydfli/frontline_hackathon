Pod::Spec.new do |s|
  s.name           = 'NearbyBle'
  s.version        = '0.1.0'
  s.summary        = 'Common Thread nearby BLE mesh transport (central + peripheral)'
  s.description    = 'CoreBluetooth central scanning and peripheral advertising with a custom GATT service, so every phone both discovers and is discoverable.'
  s.author         = 'Common Thread'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.frameworks = 'CoreBluetooth'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
