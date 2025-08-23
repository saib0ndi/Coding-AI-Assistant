// Example JavaScript code with an error
function getUserInfo(userId) {
    const user = getUser(userId);
    console.log(user.name); // Error: user might be undefined
    return user.email;
}

function getUser(id) {
    if (id === 1) {
        return { name: "John", email: "john@example.com" };
    }
    // Returns undefined for other IDs - this causes the error
}

getUserInfo(2); // This will throw: TypeError: Cannot read property 'name' of undefined