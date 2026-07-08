export {};

declare module "@auth/core/types" {
  interface User {
    sub?: string;
    userId?: string;
  }
}

declare module "next-auth" {
  interface User {
    sub?: string;
    userId?: string;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    userId?: string;
  }
}
