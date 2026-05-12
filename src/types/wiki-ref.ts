export type WikiRef =
  | { type: 'local'; name: string }
  | { type: 'remote'; name: string; localAlias: string; remoteKb: string; url: string; pat?: string }
