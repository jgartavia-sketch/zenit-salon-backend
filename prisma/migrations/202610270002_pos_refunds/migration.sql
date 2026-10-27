ALTER TABLE "ShopOrder" DROP CONSTRAINT "ShopOrder_status_check";
ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_status_check" CHECK ("status" IN ('PENDING','COMPLETED','CANCELLED','REFUNDED'));
