export interface SignedControlDatabaseContext {
  readonly attestationText: string;
  readonly signatureHex: string;
}

export interface ControlRepositoryRequest {
  readonly authorization: SignedControlDatabaseContext;
}
