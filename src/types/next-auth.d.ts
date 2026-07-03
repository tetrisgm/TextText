export {};

declare module "@auth/core/types" {
  interface User {
    sub?: string;
  }
}

declare module "next-auth" {
  interface User {
    sub?: string;
  }
}
