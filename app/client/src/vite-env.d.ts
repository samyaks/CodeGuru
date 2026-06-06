/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEMO_PROJECT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
