# Firebase Emulator Setup Baseline

## Purpose and safety boundaries

This setup is for local development and testing only. It must not access Firebase production data, and it must not be used to create or deploy a Firebase project.

Do not run `firebase login` or any deploy command as part of this local workflow. No `.firebaserc` should be committed. The repository intentionally has no default Firebase project configured; the demo project ID must be supplied explicitly when starting the emulators.

## Verified setup

The following configuration was manually verified with empty Authentication and Firestore emulators:

- Firebase CLI: 15.28.1
- Node.js: 24.20.0
- Java runtime: Temurin/OpenJDK 21.0.12.1
- Demo project ID: `demo-mapair-local`
- Authentication Emulator: <http://127.0.0.1:9099>
- Firestore Emulator: <http://127.0.0.1:8080>
- Emulator UI: <http://127.0.0.1:4000>

Start the local emulators from the repository root with:

```powershell
firebase.cmd emulators:start --project demo-mapair-local --only auth,firestore
```

Stop the Emulator Suite by pressing Ctrl+C in the terminal where it is running.

The demo project must start empty until fixtures are deliberately seeded. Firestore currently runs without a rules file, so the local emulator allows reads and writes. This behavior is only for local development and must not be interpreted as validation of production security rules.

If Firebase CLI reports a Java version below 21, run `java -version` to verify the active runtime and ensure Java 21 is first in `PATH`.

## Future work and current limitations

The following work has not been implemented or verified as application behavior:

- Fixture loading is not implemented yet.
- The current Mapair application is not connected to the emulators yet.
- Google Maps and Google Places are not emulated.

Connecting the application, defining deliberate local fixtures, and adding or validating Firestore rules are separate future tasks.
