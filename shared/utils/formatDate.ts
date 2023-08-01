const padTo2Digits = (num: number) => num.toString().padStart(2, '0')

const formatDate = (date: Date) =>
  [
    date.getFullYear(),
    padTo2Digits(date.getMonth() + 1),
    padTo2Digits(date.getDate()),
  ].join('-') +
  'T' +
  [
    padTo2Digits(date.getHours()),
    padTo2Digits(date.getMinutes()),
    padTo2Digits(date.getSeconds()),
  ].join(':')

export default formatDate
