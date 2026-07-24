// electron-builder afterPack hook.
//
// We have no Apple Developer ID certificate, so electron-builder ships the app
// UNSIGNED. On Apple Silicon an unsigned (or signature-invalidated) bundle is
// killed by Gatekeeper on launch and reported as "damaged" / "malware".
//
// An *ad-hoc* signature (`codesign -s -`) has no certificate but produces a
// valid, self-consistent signature that macOS will run locally. We apply it
// here — after the .app is packed, before any DMG is built — so both the
// unpacked app and the DMG contain a runnable, ad-hoc-signed bundle.
//
// This is NOT a substitute for Developer ID signing + notarization if you
// intend to distribute the app to other machines (those users would still get
// a Gatekeeper prompt / quarantine). It only makes the app runnable locally.
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`  • ad-hoc signing (no Developer ID)  app=${appPath}`);
  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
      stdio: 'inherit',
    });
  } catch (err) {
    console.warn(`  ! ad-hoc signing failed: ${err.message}`);
    console.warn('  ! the app may be blocked by Gatekeeper on launch.');
  }
};
