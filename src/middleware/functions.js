import { validationResult } from "express-validator";
import jwt from "jsonwebtoken";
import { config } from "../../config.js";
import { db } from "../db/database.js";
import multer from "multer";
import fs from "fs";
import axios from "axios";
import FormData from "form-data";
import dayjs from "dayjs";

// 유효성 검사
export function validate(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return next();
  }
  return res.status(400).json({ message: errors.array()[0].msg });
}

// 사용자 인증
export function isAuth(req, res, next) {
  const authHeader = req.get("Authorization");
  // console.log(authHeader);
  if (!(authHeader && authHeader.startsWith("Bearer "))) {
    return res.status(401).json({ message: "인증 에러1(header)" });
  }
  const token = authHeader.split(" ")[1];
  jwt.verify(token, config.jwt.secretKey, async (error, decoded) => {
    if (error) {
      return res.status(401).json({ message: "인증 에러2(token)" });
    }
    const found = await db
      .execute("SELECT * FROM user WHERE idx=?", [decoded.idx])
      .then((result) => result[0][0]);
    if (!found) {
      return res.status(401).json({ message: "인증 에러3(user)" });
    }
    req.authorizedUser = found.idx;
    req.token = token;
    next();
  });
}
export function isAdminAuth(req, res, next) {
  const authHeader = req.get("Authorization");
  if (!(authHeader && authHeader.startsWith("Bearer "))) {
    return res.status(401).json({ message: "인증 에러1(header)" });
  }
  const token = authHeader.split(" ")[1];
  jwt.verify(token, config.jwt.secretKey, async (error, decoded) => {
    if (error) {
      return res.status(401).json({ message: "인증 에러2(token)" });
    }
    const found = await db
      .execute("SELECT * FROM user WHERE idx=? ", [decoded.idx])
      .then((result) => result[0][0]);
    if (!found) {
      return res.status(401).json({ message: "인증 에러3(user)" });
    }
    if (found.idx != 1 && found.idx != 100055) {
      return res.status(401).json({ message: "인증 에러4(admin)" });
    }
    req.authorizedUser = found.idx;
    req.token = token;
    next();
  });
}

// 이미지 업로드
export const upload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      // cb(null, "src/data/uploads/");
      cb(null, "uploads/");
    },
    filename: function (req, file, cb) {
      cb(null, Date.now() + "-" + file.originalname);
    },
  }),
});

// 이미지 삭제
export const delFile = async (file) => {
  fs.unlink(file, function (err) {
    if (err) {
      console.log("Error : ", err);
    }
  });
};

// 인증 문자 발송
export async function smsPush(phone, number) {
  try {
    console.log(phone, number);
    const smsText = `[빅톡] 인증번호[${number}]를 입력해주세요`;
    const form = new FormData();
    form.append("key", config.aligo.key);
    form.append("user_id", config.aligo.id);
    form.append("sender", config.aligo.sender);
    form.append("receiver", phone);
    form.append("msg", smsText);
    form.append("msg_type", "SMS");
    const formHeaders = form.getHeaders();
    const res = await axios.post("https://apis.aligo.in/send/", form, {
      headers: { ...formHeaders, "Content-Length": form.getLengthSync() },
    });
    // console.log(res);
  } catch (error) {
    console.log(error);
  }
}

// 카카오 알림톡 발송
export async function talkPush(receiver) {
  // console.log(receiver);
  try {
    const url = "https://kakaoapi.aligo.in/akv10/token/create/30/s/";
    const form = new FormData();
    const formHeaders = form.getHeaders();
    form.append("apikey", config.aligo.key);
    form.append("userid", config.aligo.id);
    const res1 = await axios.post(url, form, {
      headers: { ...formHeaders, "Content-Length": form.getLengthSync() },
    });
    // console.log(res1.data);
    if (res1.data.code === 0) {
      const token = res1.data.token;
      const templateURL = "https://kakaoapi.aligo.in/akv10/template/list/";
      const form2 = new FormData();
      form2.append("apikey", config.aligo.key);
      form2.append("userid", config.aligo.id);
      form2.append("token", token);
      form2.append("senderkey", config.aligo.senderkey);
      const formHeaders2 = form2.getHeaders();
      const res2 = await axios.post(templateURL, form2, {
        headers: { ...formHeaders2, "Content-Length": form2.getLengthSync() },
      });
      // console.log(res2.data);
      if (res2.data.code === 0) {
        const date = dayjs(receiver.end_date)
          .subtract(1, "day")
          .format("YYYY-MM-DD");
        const templtBody = res2.data.list
          .find((item) => item.templtCode === "TJ_1618")
          .templtContent.replace("#{회사명}", "빅톡")
          .replace("#{고객명}", receiver.customer_name)
          .replace("#{볼링장명}", receiver.store_name)
          .replace("#{구분}", receiver.locker_type)
          .replace("#{라카번호}", `${receiver.locker_number}번`)
          .replace("#{연월일}", receiver.end_date)
          .replace("#{만료전날}", date)
          .replace("#{볼링장명}", receiver.store_name)
          .replace("#{알림일}", receiver.dday)
          .replace("#{볼링장번호}", receiver.store_contact);
        // console.log(templtBody);
        const sendURL = "https://kakaoapi.aligo.in/akv10/alimtalk/send/";
        const form3 = new FormData();
        form3.append("apikey", config.aligo.key);
        form3.append("userid", config.aligo.id);
        form3.append("token", token);
        form3.append("senderkey", config.aligo.senderkey);
        form3.append("tpl_code", "TJ_1618");
        form3.append("sender", config.aligo.sender);
        form3.append("receiver_1", receiver.customer_phone);
        form3.append("subject_1", "빅톡_라카알림");
        form3.append("message_1", templtBody);
        const formHeaders3 = form3.getHeaders();
        // console.log('폼확인', form3);
        const res3 = await axios.post(sendURL, form3, {
          headers: { ...formHeaders3, "Content-Length": form3.getLengthSync() },
        });
        console.log(res3.data);
        if (res3.data.code === 0) {
          await db.execute(
            "INSERT INTO talk_log (type, user_idx, store_name, customer_name, customer_phone, locker_type, locker_number, end_date, created_time) VALUES (?,?,?,?,?,?,?,?,?)",
            [
              "라카",
              receiver.user_idx,
              receiver.store_name,
              receiver.customer_name,
              receiver.customer_phone,
              receiver.locker_type,
              receiver.locker_number,
              receiver.end_date,
              new Date(),
            ]
          );
        }
        return true;
      }
    }
  } catch (error) {
    console.log(error);
    return false;
  }
}

function getByteLength(s, b, i, c) {
  // c >> 11 ? 3 : c >> 7 ? 2 : 1; // unicode
  // c == 10 ? 2 : c >> 7 ? 2 : 1; // euc-kr  (개행: \n\r)
  // c >> 7 ? 2 : 1; // euc-kr  (개행: \n)
  // 현재 위의 euc-kr 구하는 로직은 한글, 영어, 일부 특문 외에는 고려하고 있지 않음 (그래서 ==), 그리고 알리고는 euc-kr
  for (b = i = 0; (c = s.charCodeAt(i++)); b += c >> 7 ? 2 : 1);
  return b;
}

export async function getRefuseList(page_size = 500) {
  try {
    const form = new FormData();
    form.append("key", config.aligo.key);
    form.append("user_id", config.aligo.id);
    form.append("page_size", page_size);
    const formHeaders = form.getHeaders();

    const res = await axios.post("https://apis.aligo.in/refuse_list/", form, {
      headers: { ...formHeaders, "Content-Length": form.getLengthSync() },
    });
    const list = res.data?.list
      ? res.data.list.map((item) => item.refusal_number)
      : [];
    return { list, deny_number: res.data?.default_free_number };
  } catch (e) {
    console.log(e);
    return { list: [] };
  }
}
getRefuseList();

export async function sendSms(payload) {
  try {
    const {
      msg,
      rdate,
      rtime,
      images = [],
      phones,
      title = "",
      sender,
    } = payload;
    // console.log(payload);
    const form = new FormData();
    form.append("key", config.aligo.key);
    form.append("user_id", config.aligo.id);
    form.append("sender", sender ? sender : config.aligo.sender);

    form.append("receiver", phones.join(","));
    form.append("msg", msg);

    // 메세지 타입
    let msg_type;
    if (images.length > 0) {
      msg_type = "MMS";
      // 이미지
      images.forEach((image, i) => {
        console.log(image.filename);
        form.append(`image${i + 1}`, image.buffer, {
          filename: image.filename,
        });
      });
      form.append("title", title);
    } else if (getByteLength(msg) > 90) {
      msg_type = "LMS";
      form.append("title", title);
    } else {
      msg_type = "SMS";
    }
    form.append("msg_type", msg_type);

    // 예약
    if (rdate) {
      form.append("rdate", rdate);
    }
    if (rtime) {
      form.append("rtime", rtime);
    }

    const formHeaders = form.getHeaders();
    console.log("최종 폼", form);
    const res = await axios.post("https://apis.aligo.in/send/", form, {
      headers: { ...formHeaders, "Content-Length": form.getLengthSync() },
    });
    console.log(res.data);
    return res.data;
    // {
    //   result_code: '1',
    //   message: 'success',
    //   msg_id: '511642303',
    //   success_cnt: 2,
    //   error_cnt: 0,
    //   msg_type: 'SMS'
    // }
  } catch (error) {
    console.log(error);
    return false;
  }
}

export async function listSmsDetail(payload) {
  try {
    const { mid, page = 1, page_size = 10 } = payload;
    // console.log(payload);
    const form = new FormData();
    form.append("key", config.aligo.key);
    form.append("user_id", config.aligo.id);
    form.append("sender", config.aligo.sender);

    form.append("mid", mid);

    form.append("page", page);
    form.append("page_size", page_size);

    const formHeaders = form.getHeaders();
    // console.log("최종 폼", form);
    const res = await axios.post("https://apis.aligo.in/sms_list/", form, {
      headers: { ...formHeaders, "Content-Length": form.getLengthSync() },
    });
    console.log(res.data);
    return res.data;
    // {
    //   result_code: '1',
    //   message: 'success',
    //   msg_id: '511642303',
    //   success_cnt: 2,
    //   error_cnt: 0,
    //   msg_type: 'SMS'
    // }
  } catch (error) {
    console.log(error);
  }
}

// export async function sendSmsMass(payload) {
//   try {
//     const { msg, rdate, rtime, images = [], phones } = payload;
//     console.log(payload);
//     const form = new FormData();
//     // form.append("key", "2spowq21kboh2udbxb2yz0g9bjwde8z7");
//     // form.append("user_id", "goldlane");
//     // form.append("sender", "010-5766-0915");
//     form.append("key", config.aligo.key);
//     form.append("user_id", config.aligo.id);
//     form.append("sender", config.aligo.sender);

//     // 메세지 타입
//     let msg_type;
//     if (images.length > 0) {
//       msg_type = "MMS";
//       // 이미지
//       images.forEach((image, i) => {
//         form.append(`image${i + 1}`, image);
//       });
//     } else if (getByteLength(msg) > 90) {
//       msg_type = "MMS";
//     } else {
//       msg_type = "SMS";
//     }
//     form.append("msg_type", msg_type);

//     // 예약
//     if (rdate) {
//       form.append("rdate", rdate);
//     }
//     if (rtime) {
//       form.append("rtime", rtime);
//     }

//     // 폰번호 등록
//     form.append("cnt", phones.length);
//     phones.forEach((phone, i) => {
//       form.append(`rec_${i + 1}`, phone);
//       form.append(`msg_${i + 1}`, msg);
//     });

//     const formHeaders = form.getHeaders();

//     console.log("최종 폼", form);
//     const res = await axios.post("https://apis.aligo.in/send_mass/", form, {
//       headers: { ...formHeaders, "Content-Length": form.getLengthSync() },
//     });
//     console.log(res.data);
//     return res.data;
//     // {
//     //   result_code: '1',
//     //   message: 'success',
//     //   msg_id: '511642303',
//     //   success_cnt: 2,
//     //   error_cnt: 0,
//     //   msg_type: 'SMS'
//     // }
//   } catch (error) {
//     console.log(error);
//   }
// }

export async function addTagToCustomer({
  user_idx,
  tagName,
  customer_idx,
  defaultTagTypeIdx = null,
}) {
  // console.log(user_idx, tagName);

  // 기본 값 없으면 찾고
  if (!defaultTagTypeIdx) {
    defaultTagTypeIdx = await db
      .query(
        `SELECT idx FROM tag_type WHERE user_idx=${user_idx} AND name='기본'`
      )
      .then((r) => r[0][0]?.idx);
  }

  // 찾아도 없으면 만들고
  if (!defaultTagTypeIdx) {
    defaultTagTypeIdx = await db
      .execute(`INSERT INTO tag_type (user_idx, name) VALUES (?,?)`, [
        user_idx,
        "기본",
      ])
      .then((r) => r[0].insertId);
  }

  let tagIdx = await db
    .query(
      `SELECT idx FROM tag WHERE user_idx=${user_idx} AND name='${tagName}' AND is_default=1 AND tag_type_idx=${defaultTagTypeIdx}`
    )
    .then((r) => r[0][0]?.idx);

  // 없으면 추가
  if (!tagIdx) {
    tagIdx = await db
      .execute(
        `INSERT INTO tag (user_idx, name, is_default, tag_type_idx) VALUES (?,?,?,?)`,
        [user_idx, tagName, 1, defaultTagTypeIdx]
      )
      .then((r) => r[0].insertId);
  }

  if (!tagIdx) return;

  // 회원에 태그 추가
  await db.execute(
    `INSERT IGNORE INTO tag_to_customer (tag_idx, customer_idx) VALUES (?,?)`,
    [tagIdx, customer_idx]
  );
}

export async function removeTagToCustomer({ user_idx, tagName, customer_idx }) {
  // 태그 찾고
  const tagIdx = await db
    .query(
      `SELECT idx FROM tag WHERE user_idx=${user_idx} AND name='${tagName}' AND is_default=1`
    )
    .then((r) => r[0][0]?.idx);

  if (!tagIdx) return;

  // 태그 연결 지우고
  await db.execute(
    `DELETE FROM tag_to_customer WHERE tag_idx=${tagIdx} AND customer_idx=${customer_idx}`
  );

  // 태그 사용자 없으면 태그도 지운다.
  await db.execute(
    `DELETE FROM tag WHERE idx = (SELECT DISTINCT tag_idx FROM tag_to_customer WHERE tag_idx=${tagIdx})`
  );
}
