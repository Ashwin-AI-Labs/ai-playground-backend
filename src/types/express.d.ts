import "express";

declare module "express-serve-static-core" {
  interface Request {
    authUser?: {
      id: string;
      email: string;
      name: string;
    };
  }
}
