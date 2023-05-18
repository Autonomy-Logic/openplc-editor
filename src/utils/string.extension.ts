declare global {
  interface String {
    toCapitalize(): string;
  }
}

String.prototype.toCapitalize = function () {
  return (
    String(this) &&
    String(this)
      .split(' ')
      .map((word) => {
        return word[0].toUpperCase() + word.substring(1);
      })
      .join(' ')
  );
};

export {};
