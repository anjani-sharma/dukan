import { Router, type IRouter } from "express";
import healthRouter from "./health";
import productsRouter from "./products";
import customersRouter from "./customers";
import salesRouter from "./sales";
import invoicesRouter from "./invoices";
import dashboardRouter from "./dashboard";
import aiRouter from "./ai";
import telegramRouter from "./telegram";
import analyticsRouter from "./analytics";
import vendorPaymentsRouter from "./vendor-payments";
import purchasesRouter from "./purchases";
import returnsRouter from "./returns";

const router: IRouter = Router();

router.use(healthRouter);
router.use(productsRouter);
router.use(customersRouter);
router.use(salesRouter);
router.use(invoicesRouter);
router.use(dashboardRouter);
router.use(aiRouter);
router.use(telegramRouter);
router.use(analyticsRouter);
router.use(vendorPaymentsRouter);
router.use(purchasesRouter);
router.use(returnsRouter);

export default router;
