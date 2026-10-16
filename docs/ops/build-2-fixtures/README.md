# File-pipeline fixtures

Real files the file-pipeline tests and the live checklists use (ADR-0063, ADR-0066).

- `11-encrypted-password-test.xlsx` — a genuine password-protected workbook; **the password is
  `test`**. Made on 2026-10-16 (tech-build.3 D0a): a three-row sheet written with openpyxl 3.1.5,
  then encrypted with msoffcrypto-tool 6.0.0 (`OfficeFile(plain).encrypt("test", out)`, ECMA-376
  agile encryption). Checked before commit: olefile reads it as an OLE2 compound file holding the
  `EncryptionInfo` and `EncryptedPackage` streams, and msoffcrypto-tool decrypts it back with
  `test`. Uploading it must end `failed` with errorCode `encrypted`
  (`backend/src/routes/fileReviewFixes.integration.test.ts`).
