export function publicUser(user) {
  return {
    id: user.id,
    customerId: user.customerCode,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    purchasePoints: user.purchasePoints,
    referralPoints: user.referralPoints,
    referrals: user.referralCount,
    totalPoints: user.purchasePoints + user.referralPoints,
    createdAt: user.createdAt,
  };
}

