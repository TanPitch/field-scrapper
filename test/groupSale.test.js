import { test, expect } from "bun:test";
import { parseGroupSaleRemark, checkGroupSale } from "./groupSale.js";

test("reads count and total from the real LED remark", () => {
    const r = parseGroupSaleRemark(
        "เป็นการขายกลุ่มที่  4, ขายรวม  (แปลงที่ 40 - 72) รวม 33 แปลง, ราคาประเมินรวม 17,329,950.-บาท",
    );
    expect(r).toEqual({ lotCount: 33, totalPrice: 17329950 });
});

test("works for the second group too", () => {
    const r = parseGroupSaleRemark(
        "เป็นการขายกลุ่มที่  5, ขายรวม  (แปลงที่ 73 - 86) รวม 14 แปลง, ราคาประเมินรวม 10,386,300.-บาท",
    );
    expect(r).toEqual({ lotCount: 14, totalPrice: 10386300 });
});

test("ignores group number and plot range", () => {
    const r = parseGroupSaleRemark(
        "เป็นการขายกลุ่มที่  7, ขายรวม  (แปลงที่ 113 - 123) รวม 11 แปลง, ราคาประเมินรวม 24,930,600.-บาท",
    );
    expect(r).toEqual({ lotCount: 11, totalPrice: 24930600 });
    expect(Object.keys(r).sort()).toEqual(["lotCount", "totalPrice"]);
});

test("a non-group remark is not read as a group sale", () => {
    expect(parseGroupSaleRemark("ขายตามสำเนาหนังสือกรรมสิทธิ์ห้องชุด")).toBeNull();
    expect(parseGroupSaleRemark("")).toBeNull();
    expect(parseGroupSaleRemark(null)).toBeNull();
});

test("Thai digits parse", () => {
    const r = parseGroupSaleRemark("รวม ๓๓ แปลง, ราคาประเมินรวม ๑๗,๓๒๙,๙๕๐.-บาท");
    expect(r).toEqual({ lotCount: 33, totalPrice: 17329950 });
});

test("half a group sale is not usable, so returns null", () => {
    // count present, total missing
    expect(parseGroupSaleRemark("รวม 33 แปลง, ขายรวม")).toBeNull();
    // total present, count missing
    expect(parseGroupSaleRemark("ราคาประเมินรวม 17,329,950.-บาท")).toBeNull();
});

test("flags a lot whose price disagrees with the declared total", () => {
    const lot = {
        remark: "รวม 33 แปลง, ราคาประเมินรวม 17,329,950.-บาท",
        startPrice: 500000, caseNo: "4302", caseYear: "2549", deedNo: "3704", orderLabel: "17 - 1",
    };
    const problems = checkGroupSale(lot, [lot]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("assessed total disagrees");
});

test("flags a short group once the scrape is known complete", () => {
    const lot = {
        remark: "รวม 33 แปลง, ราคาประเมินรวม 17,329,950.-บาท",
        startPrice: 17329950, caseNo: "4302", caseYear: "2549", deedNo: "3704", orderLabel: "17 - 1",
        completeGroup: true,
    };
    expect(checkGroupSale(lot, [lot, lot])).toHaveLength(1);
    expect(checkGroupSale(lot, Array(33).fill(lot))).toHaveLength(0);
});

test("an incomplete scrape is not reported as a short group", () => {
    const lot = {
        remark: "รวม 33 แปลง, ราคาประเมินรวม 17,329,950.-บาท",
        startPrice: 17329950, caseNo: "4302", caseYear: "2549", deedNo: "3704", orderLabel: "17 - 1",
    };
    expect(checkGroupSale(lot, [lot])).toHaveLength(0);
});